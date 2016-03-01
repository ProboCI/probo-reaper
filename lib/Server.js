'use strict';

var _ = require('lodash');
var levelup = require('levelup');
var bunyan = require('bunyan');
var through2 = require('through2');
var async = require('async');
var events = require('events');
var EventEmitter = events.EventEmitter;

class Server extends EventEmitter {

  /**
   * @param {Object} options - An object containing reaper server configuration options.
   * @param {Object} options.level - An instantiated levelup compatible database instance.
   * @param {Object} options.dataDirectory - If no level instance is supplied in `options.level` this will be used as the data directory for a new leveldown backed database.
   * @param {Object} options.consumer - An instantiated probo-eventbus consumer object from which to read events.
   * @param {Object} options.log - An instantiated bunyan compatible logging object.
   */
  constructor(options) {
    super();
    this.validateOptions(options);
    this.consumer = options.consumer;
    this.level = options.level || levelup(options.dataDirectory);
    this.log = options.log || bunyan.createLogger({name: 'reaper'});
    this.messageProcessor = this.messageProcessor.bind(this);
    // Any limit set to -1 will be considered disabled.
    this.defaultLimits = {
      // Disk space is specified in gigabytes.
      diskSpace: options.defaultDiskSpaceLimit || 1,
      // Number of branches to allow.
      perBranchBuildLimit: options.perBranchBuildLimit || 1,
    };
    // Here we store the value of a gigabyte.
    this.gigabyteInBytes = 1024 * 1024 * 1024;
  }

  bytesToGigabytes(bytes) {
    return bytes / this.gigabyteInBytes;
  }

  gigabytesToBytes(gigabytes) {
    return gigabytes * this.gigabyteInBytes;
  }

  writeRecords(data, done) {
    var build = data.build;
    var batch = this.level
      .batch();
    for (let key of this.getBuildKeys(data.build)) {
      batch.put(key, JSON.stringify(build));
    }
    batch.write(done);
  }

  getBuildKeys(build) {
    return [
      `build!!${build.id}`,
      `build_date!!${build.createdAt}!!${build.id}`,
      `organization_build!!${build.project.organization.id}!!${build.createdAt}!!${build.id}`,
      `project_branch_build!!${build.project.id}!!${build.branch.name}!!${build.createdAt}!!${build.id}`,
    ];
  }

  validateOptions(options) {
    if (!options.consumer) {
      throw new Error('options.consumer is required.');
    }
    if (!options.level && !options.dataDirectory) {
      throw new Error('You must provide an instantiated level instance or a path to store the database on disk');
    }
  }

  validateMessage(data) {
    return !data.build;
  }

  messageProcessor(data, done) {
    var self = this;
    if (!self.validateMessage(data)) {
      self.writeRecords(data, function(error) {
        if (error) return self.log.error(error);
        self.enforceLimits(data.build, done);
        self.emit('buildReceived');
      });
    }
    else {
      self.log.error('Invalid build message received', data);
    }
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

  getDeleteStream(limit) {
    var counter = 1;
    var self = this;
    return through2(function(key, enc, cb) {
      counter++;
      if (limit && counter > limit) return cb();
      self.level.del(key, cb);
    });
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
      self.emit('enforcementComplete', build);
      if (done) done();
    });
  }

  enforceBuildsPerBranchLimit(build, done) {
    var pattern = `project_branch_build!!${build.project.id}!!${build.branch.name}!!`;
    var self = this;
    self.getValuesArray(pattern + '!', pattern + '~', function(error, branchBuilds) {
      var limit = self.getSubscriptionRule(build, 'perBranchBuildLimit');
      async.map(branchBuilds.slice(0, -1 * limit), self.reap.bind(self), done);
    });
  }

  getSubscriptionRule(build, rule) {
    var projectSpecificSetting = false;
    if (build.project && build.project.organization && build.project.organization.subscription && build.project.organization.subscription.rules) {
      projectSpecificSetting = build.project.organization.subscription.rules[rule];
    }
    return projectSpecificSetting || this.defaultLimits[rule];
  }

  reap(build, done) {
    console.log(`💀 💀 💀  REAPING ${build.id}`);
    this.deleteBuildFromDB(build, done);
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
    self.getOrganizationBuilds(build.project.organization.id, function(error, organizationBuilds) {

      // This is the project specific limit (in gigabytes).
      var limit = self.gigabytesToBytes(self.getSubscriptionRule(build, 'diskSpace'));
      var currentUsage = self.aggregateSize(organizationBuilds);

      console.log('total size is: ', self.bytesToGigabytes(currentUsage) + ' limit is: ' + self.bytesToGigabytes(limit));
      organizationBuilds = self.sortOrganizationBuildsForReap(organizationBuilds);

      var buildsToReap = [];
      for (let build of organizationBuilds) {
        if (currentUsage > limit) {
          currentUsage -= build.diskSpace.real;
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
    this.sortArrayByBuildDates(newestByBranch);
    this.sortArrayByBuildDates(remainingBuilds);

    // Tack the array of the most recent build for each branch which
    // we most want to keep onto the end of the sorted older builds.
    return remainingBuilds.concat(newestByBranch);
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
    builds.sort(dateSorter);
  }

  indexByBranch(builds) {
    var branches = {};
    for (let build of builds) {
      branches[build.branch.name] = branches[build.branch.name] || [];
      branches[build.branch.name].push(build);
    }
    return branches;
  }

  aggregateSize(builds, done) {
    var reducer = function(size, build) { return build.diskSpace.real + size; };
    return _.reduce(builds, reducer, 0);
  }

  start(done) {
    var self = this;
    this.consumer.stream.pipe(through2.obj(function(data, enc, cb) {
      self.messageProcessor(data, function() {
        cb();
      });
    }));
    done();
  }

  stop(done) {
    this.consumer.destroy(done);
  }

}

module.exports = Server;
