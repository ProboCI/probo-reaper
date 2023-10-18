'use strict';

const _ = require('lodash');
const async = require('async');
const events = require('events');
const leveldown = require('leveldown');
const levelup = require('levelup');
const request = require('request');
const through2 = require('through2');

const EventConsumer = require('./event_consumer');
const reapedReasons = require('./constants');
const logger = require('./logger').get();

const EventEmitter = events.EventEmitter;

class Server extends EventEmitter {

  /**
   * @param {Object} options - An object containing reaper server
   *  configuration options.
   * @param {String} options.apiServerHost - The host to listen to for the API server.
   * @param {Number} options.apiServerPort - The port to listen to for the API server.
   * @param {Object} options.containerManagerUrl - The URL at which to send
   *  reap messages.
   * @param {Object} options.dataDirectory - If no level instance is supplied
   *  in `options.level` this will be used as the data directory for a new
   *  leveldown backed database.
   * @param {Array} options.limitRuleExclutions - An array of objects containing patterns to exclude.
   * @param {Object} options.level - An instantiated levelup compatible
   *  database instance.
   */
  constructor(options) {
    super();
    this.validateOptions(options);
    this.consumer = options.consumer || new EventConsumer(options.eventStreamConfig);
    this.level = options.level || levelup(leveldown(options.dataDirectory));
    this.limitRuleExclutions = options.limitRuleExclutions || [];
    this.log = options.logger || logger;
    this.messageProcessor = this.messageProcessor.bind(this);
    this.containerManagerUrl = options.containerManagerUrl || 'http://localhost:3020';
    this.dbUrl = options.dbUrl;
    // Any limit set to -1 will be considered disabled.
    this.defaultLimits = {
      // Disk space is specified in gigabytes.
      diskSpace: options.defaultDiskSpaceLimit || 1,
      // Number of branches to allow.
      perBranchBuildLimit: options.perBranchBuildLimit || 1,
    };
    // Here we store the value of a gigabyte.
    this.bytesInGigabyte = 1024 * 1024 * 1024;

    this.apiServerHost = options.apiServerHost;
    this.apiServerPort = options.apiServerPort;
    this.start = this.start.bind(this);
  }

  bytesToGigabytes(bytes) {
    return bytes / this.bytesInGigabyte;
  }

  gigabytesToBytes(gigabytes) {
    return gigabytes * this.bytesInGigabyte;
  }

  saveBuild(build, done) {
    var buildString = JSON.stringify(build);
    var batch = this.level
      .batch();
    for (let key of this.getBuildKeys(build)) {
      batch.put(key, buildString);
    }
    batch.write(done);
  }

  getBuildKeys(build) {
    var keys = [
      `build!!${build.id}`,
      `build_date!!${build.createdAt}!!${build.id}`,
    ];
    if (build.project && build.project.organization) {
      keys.push(`organization_build!!${build.project.organizationId}!!${build.createdAt}!!${build.id}`);
    }
    if (build.branch && build.branch.name) {
      keys.push(`project_branch_build!!${build.project.id}!!${build.branch.name}!!${build.createdAt}!!${build.id}`);
    }
    return keys;
  }

  validateOptions(options) {
    if (!options.level && !options.dataDirectory) {
      throw new Error('You must provide an instantiated level instance or a path to store the database on disk');
    }
  }

  messageIsValid(data) {
    return !!data.build;
  }

  getLogContext(build) {
    var context = {
      buildId: build.id,
    };
    if (build.project && build.project.id) {
      context.projectId = build.project.id;
    }
    if (build.project.organization && build.project.organization) {
      context.organizationId = build.project.organizationId;
    }
    return context;
  }

  messageProcessor(data, done) {
    var self = this;
    if (!self.messageIsValid(data)) {
      self.log.error('Invalid build message received', data);
      return done();
    }
    let build = data.build;
    switch (data.event) {
      case 'ready':
        this.processReadyEvent(build, done);
        break;
      case 'updated':
        this.processUpdatedEvent(build, done);
        break;
      case 'reaped':
        this.processReapedEvent(build, done);
        break;
      default:
        done();
    }
  }

  processReadyEvent(build, done) {
    const self = this;
    var message = `Enforcing limits for ${build.id}`;
    if (build.project && build.project.organization) {
      message += ` for organization ${build.project.organizationId}`;
    }
    self.log.info(self.getLogContext(build), message);
    self.saveBuild(build, function(error) {
      if (error) {
        return self.log.error(error);
      }
      self.enforceLimits(build, done);
      self.emit('buildReceived', build);
    });
  }

  processUpdatedEvent(build, done) {
    const self = this;
    self.saveBuild(build, function(error) {
      if (error) {
        return self.log.error(error);
      }
      self.emit('updateReceived', build);
      done();
    });
  }

  processReapedEvent(build, done) {
    const self = this;
    self.deleteBuildFromDB(build, function(error) {
      if (error) {
        return self.log.error(error);
      }
      self.log.info(self.getLogContext(build), `Reap event received, removed build ${build.id} from the database.`);
      self.emit('reapReceived', build);
      done();
    });
  }

  getKeyAndValueArray(greaterThan, lessThan, done) {
    var outputData = [];

    this.level
      .createReadStream({gt: greaterThan, lt: lessThan, valueEncoding: 'json'})
      .pipe(through2.obj(function(build, _, callback) {

        build.key = build.key.toString();
        build.value = JSON.parse(build.value.toString());

        this.push(build);

        callback();
      }))
      .on('data', build => {
        outputData.push(build);
      })
      .on('end', () => {
        done(null, outputData);
      });;
  }

  getValuesArray(greaterThan, lessThan, done) {
    var outputData = [];

    this.level
      .createValueStream({gt: greaterThan, lt: lessThan, valueEncoding: 'json'})
      .pipe(through2.obj(function(build, _, callback) {

        this.push(JSON.parse(build.toString()));

        callback();
      }))
      .on('data', build => {
        outputData.push(build);
      })
      .on('end', () => {
        done(null, outputData);
      });
  }

  /**
   * Fetch all builds for a given branch on a given project.
   *
   * @param {Object} build - A build object
   * @param {Function} done - The function to call with parameters for error and results.
   */
  getProjectBranchBuilds(build, done) {
    var prefix = `project_branch_build!!${build.project.id}!!${build.branch.name}!!`;
    this.getKeyAndValueArray(`${prefix}!`, `${prefix}~`, done);
  }

  excludeFromLimits(build) {
    for (let excludeRule of this.limitRuleExclutions) {
      if (_.isMatch(build, excludeRule.pattern)) {
        return excludeRule;
      }
    }
    return false;
  }

  enforceLimits(build, done) {
    var self = this;
    var tasks = [];
    // Always enforce per-branch limits.
    if (self.getSubscriptionRule(build, 'perBranchBuildLimit') !== -1) {
      tasks.push(self.enforceBuildsPerBranchLimit.bind(self, build));
    }
    const exclude = this.excludeFromLimits(build);
    if (exclude) {
      self.log.info(self.getLogContext(build), `Build ${build.id} was excluded from from disk space limits because "${exclude.name}".`);
      self.emit('enforcementComplete', build);
      return done();
    }
    if (self.getSubscriptionRule(build, 'diskSpace') !== -1) {
      tasks.push(self.enforceSizeLimit.bind(self, build));
    }
    async.series(tasks, function(error) {
      if (error) {
        self.log.error(`An error occurred while enforcing limits for ${build.id}`, error);
      }
      self.emit('enforcementComplete', build);
      if (done) {
        done();
      }
    });
  }

  enforceBuildsPerBranchLimit(build, done) {
    if (build.branch && build.branch.name) {
      let pattern = `project_branch_build!!${build.project.id}!!${build.branch.name}!!`;
      let self = this;
      self.getValuesArray(pattern + '!', pattern + '~', function(error, branchBuilds) {

        let limit = self.getSubscriptionRule(build, 'perBranchBuildLimit');
        let sortedBranchBuilds = self.sortOrganizationBuildsForReap(branchBuilds);
        _.remove(sortedBranchBuilds, function(item) {
          return item.pinned;
        });

        let buildsToReap = sortedBranchBuilds.slice(0, -1 * limit);
        buildsToReap.forEach(function(build) {
          build.reapedReason = reapedReasons.REAPED_REASON_BRANCH_BUILDS;
        });
        async.map(buildsToReap, self.reap.bind(self), done);
      });
    }
    else {
      done();
    }
  }

  getSubscriptionRule(build, rule) {
    let projectSpecificSetting;
    try {
      projectSpecificSetting = build.project.organization.subscription.rules[rule];
    }
    catch (e) {
      projectSpecificSetting = false;
    }
    return Number.isInteger(projectSpecificSetting) ? projectSpecificSetting : this.defaultLimits[rule];
  }

  reap(build, done) {
    const buildId = build.id;
    if (!build.container) {
      this.log.error(this.getLogContext(build), `Build ${buildId} lacks container information, skipping`);
      return done();
    }

    this.log.info(this.getLogContext(build), `Reaping ${buildId} and removing container ${build.container.id}`);

    var self = this;
    const options = {
      url: `${self.containerManagerUrl}/builds/${buildId}`,
      qs: {
        force: true,
        reason: build.reapedReason.constant || reapedReasons.REAPED_REASON_UNKNOWN.constant,
        reasonText: build.reapedReason.description || reapedReasons.REAPED_REASON_UNKNOWN.description,
        reapedDate: Date.now(),
      },
    };

    request.del(options, function(error, response, body) {
      if (error) {
        self.log.error(Object.assign({}, self.getLogContext(build), options), `Container manager could not reap build ${buildId}`);
        return done(error);
      }

      self.log.info(Object.assign({}, self.getLogContext(build), options), `Reaping build ${buildId}`);

      // We consider a 404 successful because it
      // could mean this record has already been deleted.
      if (response.statusCode !== 200 && response.statusCode !== 404) {
        self.log.error(Object.assign({}, self.getLogContext(build), options), `Failed to reap build ${buildId}`);
        return done(new Error(body));
      }

      if (response.statusCode === 404) {
        self.log.warn(Object.assign({}, self.getLogContext(build), options), `A 404 was encountered while trying to reap container. Assuming the build has already been reaped and removing from the database.`);
      }

      self.deleteBuildFromDB(build, done);
    });
  }

  deleteBuildFromDB(build, done) {
    var batch = this.level.batch();
    for (let key of this.getBuildKeys(build)) {
      batch.del(key);
    }
    batch.write(done);
  }

  getOrganizationBuilds(organizationId, done) {
    var pattern = `organization_build!!${organizationId}`;
    this.getValuesArray(pattern + '!', pattern + '~', done);
  }

  enforceSizeLimit(build, done) {
    let self = this;
    let organizationId = false;
    try {
      organizationId = build.project.organizationId;
    }
    catch (error) {
      self.log.error(`No organization found, skipping enforcement for build ${build.id}`, {error, build});
      return done();
    }
    self.getBuildsToReap(organizationId, build, function(error, buildsToReap) {
      async.each(buildsToReap, self.reap.bind(self), done);
    });
  }

  getBuildsToReap(organizationId, build, done) {
    let self = this;
    async.parallel([
      function(callback) {
        self.getOrganizationBuilds(organizationId, function(error, organizationBuilds) {
          callback(error, organizationBuilds);
        });
      },
      function(callback) {
        self.getOrganizationDiskUsage(organizationId, function(error, diskUsage) {
          callback(error, diskUsage);
        });
      },
    ], function(error, results) {
      if (error) {
        return done(error);
      }
      let organizationBuilds = results[0];
      let currentUsage = results[1];
      let limit = self.gigabytesToBytes(self.getSubscriptionRule(build, 'diskSpace'));
      let buildsToReap = [];
      self.log.info(self.getLogContext(build), `Organization ${organizationId} is using ${self.bytesToGigabytes(currentUsage)}G out of their ${self.bytesToGigabytes(limit)}G limit`, {buildId: build.id});
      organizationBuilds = self.sortOrganizationBuildsForReap(organizationBuilds);

      let index = 0;
      let stop = 0;
      while (currentUsage > limit && stop == 0) {
        let build = organizationBuilds[index];
        if (typeof build != 'undefined') {
          build.reapedReason = reapedReasons.REAPED_REASON_DISK_LIMIT;
          buildsToReap.push(build);
          currentUsage -= build.diskSpace.realBytes;
        }
        else {
          stop = 1;
        }
        index++;
      }

      done(null, buildsToReap);
    });
  }

  /**
   * This function performs our reap sort order.
   *
   * @param {Array} builds - An array of builds for a single organization.
   * @return {Array} - An array of builds sorted in from most to least expendible.
   */
  sortOrganizationBuildsForReap(builds) {
    // Organize build array into an object containing.
    var indexedByBranch = this.indexByBranch(builds);

    // We separate the newest builds for each branch to ensure they are the last to reap.
    var newestByBranch = [];
    var remainingBuilds = [];

    // Separate the newest builds from the remaining builds.
    for (let branch in indexedByBranch) {
      if (indexedByBranch.hasOwnProperty(branch)) {
        newestByBranch.push(indexedByBranch[branch].pop());
        remainingBuilds = remainingBuilds.concat(indexedByBranch[branch]);
      }
    }

    // Sort the in ascending date order.
    newestByBranch = this.sortArrayByBuildDates(newestByBranch);
    remainingBuilds = this.sortArrayByBuildDates(remainingBuilds);

    // Create new array with the oldest builds at the front.
    let orderedBuilds = remainingBuilds.concat(newestByBranch);

    // Break date ordered array into arrays for pinned and unpinned.
    let unpinned = _.filter(orderedBuilds, function(build) {
      return !build.pinned;
    });
    let pinned = _.filter(orderedBuilds, function(build) {
      return build.pinned && build.pinned === true;
    });

    // Return new array with oldest unpinned at the front.
    return unpinned.concat(pinned);
  }

  sortArrayByBuildDates(builds) {
    var dateSorter = function(buildA, buildB) {
      if (buildA.createdAt < buildB.createdAt) {
        return -1;
      }
      if (buildA.createdAt === buildB.createdAt) {
        return 0;
      }
      if (buildA.createdAt > buildB.createdAt) {
        return 1;
      }
    };

    return builds.sort(dateSorter);
  }

  indexByBranch(builds) {
    var branches = {};
    for (let build of builds) {
      if (build.branch && build.branch.name) {
        branches[build.branch.name] = branches[build.branch.name] || [];
        branches[build.branch.name].push(build);
      }
    }
    return branches;
  }

  getOrganizationDiskUsage(organizationId, done) {
    let self = this;
    const options = {
      url: `${self.dbUrl}/organization/${organizationId}/disk-usage`,
    };

    request.get(options, function(error, response, body) {
      if (error) {
        self.log.error(`ProboDb failed to give disk usage data for organization ${organizationId}`);
        return done(error);
      }
      self.log.info(body);
      done(null, body.replace(/\D/g, ''));
    });
  }

  start() {
    this.startStreamListeners();

    this.log.info(`Now subscribed to events on ${this.consumer.topic}`);
  }

  /**
   * Starts Kafka event stream listeners.
   */
  startStreamListeners() {
    this.consumer.start()
      .then(() => {
        this.consumer.onMessage(data => {

          if (!data || !data.build) {
            return;
          }

          this.messageProcessor(data, err => {
            if (err) {
              this.log.error({err: err}, 'There was an error processing build data');

              return;
            }

            this.consumer.commit();
          });

        });

      });

  }

  stop(done) {
    this.consumer.destroy(done);
  }

}

module.exports = Server;
