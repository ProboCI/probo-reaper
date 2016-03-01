'use strict';

var levelup = require('levelup');
var bunyan = require('bunyan');

class Server {

  constructor(options) {
    this.validateOptions(options);
    this.consumer = options.consumer;
    this.level = options.level || levelup(options.dataDirectory);
    this.log = options.log || bunyan.createLogger({name: 'reaper'});
    this.messageProcessor = this.messageProcessor.bind(this);
  }

  writeRecords(data, done) {
    var build = data.build;
    this.level
      .batch()
      .put(`build!!${build.id}`, JSON.stringify(build))
      .put(`build_date!!${build.createdAt}!!${build.id}`, build.id)
      .put(`project_branch_build!!${build.project.id}!!${build.branch.name}!!${build.createdAt}!!${build.id}`, build.id)
      .put(`organization_build!!${build.project.organization.id}!!${build.id}`, build.id)
      .write(done);
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

  messageProcessor(data) {
    var self = this;
    if (!self.validateMessage(data)) {
      self.writeRecords(data, function(error) {
        if (error) return self.log.error(error);
        self.enforceLimits();
      });
    }
    else {
      self.log.error('Invalid build message received', data);
    }
  }

  enforceLimits() {
  }

  enforceBuildsPerBranchLimit() {
  }

  enforceSizeLimit() {
  }

  aggregateSize(query, done) {
  }

  start(done) {
    this.consumer.stream.on('data', this.messageProcessor);
    done();
  }

  stop(done) {
    this.consumer.destroy(done);
  }

}

module.exports = Server;
