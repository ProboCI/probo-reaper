'use strict';

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
    this.defaultPerBranchBuildLimit = options.defaultPerBranchBuildLimit || 1;
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
      `project_branch_build!!${build.project.id}!!${build.branch.name}!!${build.createdAt}!!`,
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
    tasks.push(this.enforceBuildsPerBranchLimit.bind(this, build));
    async.series(tasks, function(error) {
      self.emit('enforcementComplete', build);
      if (done) done();
    });
  }

  enforceBuildsPerBranchLimit(build, done) {
    var pattern = `project_branch_build!!${build.project.id}!!${build.branch.name}!!`;
    var self = this;
    self.getValuesArray(pattern + '!', pattern + '~', function(error, branchBuilds) {
      var limit = self.getBuildPerBranchLimit(build);
      async.map(branchBuilds.slice(0, - limit), self.reap.bind(self), done);
    });
  }

  getBuildPerBranchLimit(build) {
    console.log(build.branch.name);
    if (build.branch.name == 'branch 3') {
      console.log('👅 👅 👅 👅 👅 👅 ');
      console.log(build.project.organization.subscription && build.project.organization.subscription.rules);
    }
    var projectSpecificSetting = false;
    if (build.project && build.project.organization && build.project.organization.subscription && build.project.organization.subscription.rules) {
      projectSpecificSetting = build.project.organization.subscription.rules.perBranchBuildLimit;
      console.log(projectSpecificSetting);
    }
    return projectSpecificSetting || this.defaultPerBranchBuildLimit;
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

  enforceSizeLimit() {
  }

  aggregateSize(query, done) {
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
