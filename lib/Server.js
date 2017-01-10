'use strict';

var async = require('async');
var bunyan = require('bunyan');
var events = require('events');
var levelup = require('levelup');
var _ = require('lodash');
var request = require('request');
var restify = require('restify');
var through2 = require('through2');
var EventEmitter = events.EventEmitter;
var reapedReasons = require('./constants');

class Server extends EventEmitter {

  /**
   * @param {Object} options - An object containing reaper server
   *  configuration options.
   * @param {Object} options.level - An instantiated levelup compatible
   *  database instance.
   * @param {Object} options.dataDirectory - If no level instance is supplied
   *  in `options.level` this will be used as the data directory for a new
   *  leveldown backed database.
   * @param {Object} options.consumer - An instantiated probo-eventbus consumer
   *  object from which to read events.
   * @param {Object} options.log - An instantiated bunyan compatible
   *  logging object.
   * @param {Object} options.containerManagerUrl - The URL at which to send
   *  reap messages.
   * @param {Object} options.log - An instantiated bunyan compatible
   *  logging object.
   */
  constructor(options) {
    super();
    this.validateOptions(options);
    this.consumer = options.consumer;
    this.level = options.level || levelup(options.dataDirectory);
    this.log = options.log || bunyan.createLogger({name: 'reaper'});
    this.messageProcessor = this.messageProcessor.bind(this);
    this.containerManagerUrl = options.containerManagerUrl || 'http://localhost:3020';
    // Any limit set to -1 will be considered disabled.
    this.defaultLimits = {
      // Disk space is specified in gigabytes.
      diskSpace: options.defaultDiskSpaceLimit || 1,
      // Number of branches to allow.
      perBranchBuildLimit: options.perBranchBuildLimit || 1,
    };
    // Here we store the value of a gigabyte.
    this.bytesInGigabyte = 1024 * 1024 * 1024;

    this.prepareServer(options);
  }

  prepareServer(options) {
    var host = options.apiServerHost;
    var port = options.apiServerPort;
    var self = this;
    this.restServer = restify.createServer();
    this.restServer.get('/api/export-data', function(req, res, next) {
      res.writeHead(200);
      var dataStream = self.level.createReadStream({valueEncoding: 'json'});
      dataStream.pipe(through2.obj(function(data, enc, cb) {
        cb(null, JSON.stringify(data) + '\n');
      }))
      .pipe(res);
    });

    this.restServer.listen(port, host, function() {
      self.log.info(`REST API listening at ${host}:${port}`);
    });
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
      keys.push(`organization_build!!${build.project.organization.id}!!${build.createdAt}!!${build.id}`);
    }
    if (build.branch && build.branch.name) {
      keys.push(`project_branch_build!!${build.project.id}!!${build.branch.name}!!${build.createdAt}!!${build.id}`);
    }
    return keys;
  }

  validateOptions(options) {
    if (!options.consumer) {
      throw new Error('options.consumer is required.');
    }
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
      context.organizationId = build.project.organization.id;
    }
    return context;
  }

  messageProcessor(data, done) {
    var self = this;
    self.log.trace('Eventbus event received', data);
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
      default:
        done();
    }
  }

  processReadyEvent(build, done) {
    const self = this;
    var message = `Enforcing limits for ${build.id}`;
    if (build.project && build.project.organization) {
      message += ` for organization ${build.project.organization.id}`;
    }
    self.log.info(self.getLogContext(build), message);
    self.saveBuild(build, function(error) {
      if (error) {
        return self.log.error(error);
      }
      self.enforceLimits(build, done);
      self.emit('buildReceived');
    });
  }

  processUpdatedEvent(build, done) {
    const self = this;
    self.saveBuild(build, function(error) {
      if (error) {
        return self.log.error(error);
      }
      self.emit('updateReceived');
      done();
    });
  }

  getKeyAndValueArray(greaterThan, lessThan, done) {
    var outputData = [];
    var collector = function(data, enc, cb) {
      outputData.push(data);
      cb();
    };
    var output = function(cb) {
      cb();
      done(null, outputData);
    };
    this.level
      .createReadStream({gt: greaterThan, lt: lessThan, valueEncoding: 'json'})
      .pipe(through2.obj(collector, output));
  }

  getValuesArray(greaterThan, lessThan, done) {
    var outputData = [];
    var collector = function(data, enc, cb) {
      outputData.push(data);
      cb();
    };
    var output = function(cb) {
      cb();
      done(null, outputData);
    };
    this.level
      .createValueStream({gt: greaterThan, lt: lessThan, valueEncoding: 'json'})
      .pipe(through2.obj(collector, output));
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

  enforceLimits(build, done) {
    var self = this;
    var tasks = [];
    if (self.getSubscriptionRule(build, 'perBranchBuildLimit') !== -1) {
      tasks.push(this.enforceBuildsPerBranchLimit.bind(this, build));
    }
    if (self.getSubscriptionRule(build, 'diskSpace') !== -1) {
      tasks.push(this.enforceSizeLimit.bind(this, build));
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
    var containerId = build.container.id;
    const options = {
      url: `${self.containerManagerUrl}/containers/${containerId}`,
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
    var self = this;
    var organizationId = build.project.organization.id;
    self.getOrganizationBuilds(organizationId, function(error, organizationBuilds) {
      // This is the project specific limit (in gigabytes).
      var limit = self.gigabytesToBytes(self.getSubscriptionRule(build, 'diskSpace'));
      var currentUsage = self.aggregateSize(organizationBuilds);

      self.log.info(self.getLogContext(build), `Organization ${organizationId} is using ${self.bytesToGigabytes(currentUsage)}G out of their ${self.bytesToGigabytes(limit)}G limit`, {buildId: build.id});
      organizationBuilds = self.sortOrganizationBuildsForReap(organizationBuilds);

      var buildsToReap = [];
      for (let build of organizationBuilds) {
        if (currentUsage > limit) {
          currentUsage -= build.diskSpace.realBytes;
          build.reapedReason = reapedReasons.REAPED_REASON_DISK_LIMIT;
          buildsToReap.push(build);
        }
      }
      async.each(buildsToReap, self.reap.bind(self), done);
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

  aggregateSize(builds, done) {
    var reducer = function(size, build) {
      if (build.diskSpace.realBytes !== -1) {
        return build.diskSpace.realBytes + size;
      }
      return size;
    };
    return _.reduce(builds, reducer, 0);
  }

  start(done) {
    var self = this;
    this.consumer.stream.pipe(through2.obj(function(data, enc, cb) {
      self.messageProcessor(data, function() {
        cb();
      });
    }));
    this.log.info(`Now subscribed to events on ${this.consumer.topic}`);
    if (done) done();
  }

  stop(done) {
    this.consumer.destroy(done);
    this.restServer.close();
  }

}

module.exports = Server;
