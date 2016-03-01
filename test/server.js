'use strict';

var _ = require('lodash');
var should = require('should');
var levelup = require('levelup');
var memdown = require('memdown');
var eventbus = require('probo-eventbus');
var lib = require('..');
var Server = lib.Server;
var through2 = require('through2');
var async = require('async');

// We use a simple method to reset the world between tests by
// using global variables.
var stream = null;
var server = null;
var storage = null;

function getTestBuildEvent(object) {
  object = object || {};
  var baseline = {
    id: 'build 1',
    createdAt: '2016-02-27T05:44:46.947Z',
    project: {
      id: 'project 1',
      organization: {
        id: 'organization 1',
        subscription: {
          rules: {},
        },
      },
    },
    branch: {
      name: 'branch 1',
    },
    diskSpace: {
      real: server.gigabytesToBytes(0.5),
      virtual: server.gigabytesToBytes(1),
    },
  };
  return {build: _.merge(baseline, object)};
}

function getEventCounter(number, done) {
  var counter = 0;
  return function() {
    counter++;
    if (counter === number) {
      done();
    }
  };
}


describe('Server', function() {
  describe('event storage', function() {
    beforeEach(function(done) {
      memdown.clearGlobalStore();
      stream = through2.obj();
      storage = levelup('./test', {db: memdown});
      var options = {
        level: storage,
        consumer: new eventbus.plugins.Memory.Consumer({stream}),
      };
      server = new Server(options);
      server.start(done);
    });
    afterEach(function(done) {
      server.stop(done);
    });
    it('should store builds indexed by build id, date, organization, and branch', function(done) {
      stream.write(getTestBuildEvent());
      stream.write(getTestBuildEvent({id: 'build 2', project: {id: 'project 2'}}));
      server.on('buildReceived', getEventCounter(2, function() {
        server.getKeyAndValueArray('!', '~', function(error, records) {
          should.exist(server);
          records.length.should.equal(8);
          records[0].key.should.equal('build!!build 1');
          records[1].key.should.equal('build!!build 2');
          records[2].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 1');
          records[3].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 2');
          records[4].key.should.equal('organization_build!!organization 1!!2016-02-27T05:44:46.947Z!!build 1');
          records[5].key.should.equal('organization_build!!organization 1!!2016-02-27T05:44:46.947Z!!build 2');
          records[6].key.should.equal('project_branch_build!!project 1!!branch 1!!2016-02-27T05:44:46.947Z!!build 1');
          records[7].key.should.equal('project_branch_build!!project 2!!branch 1!!2016-02-27T05:44:46.947Z!!build 2');
          done();
        });
      }));
    });
    it('should query for individual records', function(done) {
      stream.write(getTestBuildEvent());
      stream.write(getTestBuildEvent({id: 'build 3'}));
      server.on('buildReceived', getEventCounter(2, function() {
        server.getValuesArray('build!!!', 'build!!~', function(error, results) {
          results.length.should.equal(2);
          JSON.stringify(results[0]).should.equal(JSON.stringify(getTestBuildEvent().build));
          done(error);
        });
      }));
    });
    it('should reap all but the most recent X builds on a branch based on configuration', function(done) {
      stream.write(getTestBuildEvent({id: 'build 1', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}}));
      stream.write(getTestBuildEvent({id: 'build 2', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 1'}}));
      stream.write(getTestBuildEvent({id: 'build 3', createdAt: '2016-02-03T05:44:46.947Z', branch: {name: 'branch 2'}}));
      stream.write(getTestBuildEvent({id: 'build 4', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 2'}}));
      var project = {
        id: 'project 1',
        organization: {
          id: 'organization 2',
          subscription: {
            rules: {
              perBranchBuildLimit: 3,
              diskSpace: -1,
            },
          },
        },
      };
      stream.write(getTestBuildEvent({id: 'build 5', createdAt: '2016-02-05T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      stream.write(getTestBuildEvent({id: 'build 6', createdAt: '2016-02-06T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      stream.write(getTestBuildEvent({id: 'build 7', createdAt: '2016-02-07T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      var lastBranch3Build = getTestBuildEvent({id: 'build 8', createdAt: '2016-02-08T05:44:46.947Z', branch: {name: 'branch 3'}, project});
      stream.write(lastBranch3Build);
      var lastBranch1Build = getTestBuildEvent({id: 'build 9', createdAt: '2016-03-09T05:44:46.947Z', branch: {name: 'branch 1'}});
      stream.write(lastBranch1Build);
      var lastBranch2Build = getTestBuildEvent({id: 'build 10', createdAt: '2016-02-10T05:44:46.947Z', branch: {name: 'branch 2'}});
      stream.write(lastBranch2Build);
      server.on('enforcementComplete', getEventCounter(10, function(triggeringBuild) {
        async.map([lastBranch1Build.build, lastBranch2Build.build, lastBranch3Build.build], server.getProjectBranchBuilds.bind(server), function(error, results) {
          results[0][0].value.id.should.equal('build 9');
          results[0].length.should.equal(1);
          results[1][0].value.id.should.equal('build 10');
          results[1].length.should.equal(1);
          results[2][0].value.id.should.equal('build 6');
          results[2][1].value.id.should.equal('build 7');
          results[2][2].value.id.should.equal('build 8');
          results[2].length.should.equal(3);
          done();
        });
      }));
    });
    it('should reap however many builds are necessary to get under the configured size limit for a given organization', function(done) {
      var project = {
        id: 'project 2',
        organization: {
          id: 'organization 2',
          subscription: {
            rules: {
              diskSpace: 2,
              perBranchBuildLimit: -1,
            },
          },
        },
      };
      stream.write(getTestBuildEvent({id: 'build 1', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}}));
      stream.write(getTestBuildEvent({id: 'build 2', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 2'}}));
      stream.write(getTestBuildEvent({id: 'build 3', createdAt: '2016-02-03T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      stream.write(getTestBuildEvent({id: 'build 4', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 3'}}));
      stream.write(getTestBuildEvent({id: 'build 5', createdAt: '2016-02-04T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      stream.write(getTestBuildEvent({id: 'build 6', createdAt: '2016-02-05T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      stream.write(getTestBuildEvent({id: 'build 7', createdAt: '2016-02-06T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      stream.write(getTestBuildEvent({id: 'build 8', createdAt: '2016-02-07T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      stream.write(getTestBuildEvent({id: 'build 9', createdAt: '2016-02-08T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      stream.write(getTestBuildEvent({id: 'build 10', createdAt: '2016-02-09T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      stream.write(getTestBuildEvent({id: 'build 11', createdAt: '2016-02-10T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      stream.write(getTestBuildEvent({id: 'build 12', createdAt: '2016-02-11T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      server.on('enforcementComplete', getEventCounter(12, function(triggeringBuild) {
        setTimeout(function() {
          var tasks = {
            allBuilds: server.getKeyAndValueArray.bind(server, 'build!!!', 'build!!~'),
            organization1: server.getOrganizationBuilds.bind(server, 'organization 1'),
            organization2: server.getOrganizationBuilds.bind(server, 'organization 2'),
          };
          async.parallel(tasks, function(error, results) {
            should.not.exist(error);
            results.allBuilds.length.should.equal(6);
            results.organization1.length.should.equal(2);
            // Verify that this organization is down to 2 gigabytes.
            server.bytesToGigabytes(server.aggregateSize(results.organization2)).should.equal(2);
            // Verify that this organization is down to 1 gigabytes.
            server.bytesToGigabytes(server.aggregateSize(results.organization1)).should.equal(1);
            results.organization2.length.should.equal(4);
            done();
          });
        }, 200);
      }));
    });
    it('should reap all builds older than a conifgurable time window');
    // TODO: When should we check? Ideally we subscribe to provider (github/bitbucket) events but we could miss one so
    // we may need/want to perform some kind of "true-up".
    it('should delete all environments for a pull request that has been closed');
  });
});
