'use strict';

const async = require('async');
const bunyan = require('bunyan');
const levelup = require('levelup');
const _ = require('lodash');
const memdown = require('memdown');
const nock = require('nock');
const eventbus = require('probo-eventbus');
const request = require('request');
const should = require('should');
const through2 = require('through2');
const lib = require('..');
const Server = lib.Server;

const organizationId1 = 'ef71e66b-b157-49ef-b6f4-90b618ac2c8c';
const organizationId2 = '3d1c0855-3c8d-402f-8838-4ca2d7e7bbc7';

nock('http://localhost:9631')
  .persist()
  .delete(/\/containers\/some\%20container\?force\=true\&reason\=.*/)
  .reply(200);

// We use a simple method to reset the world between tests by
// using global variables.
var producer = null;
var stream = null;
var server = null;
var storage = null;
var logStorage = [];

/**
 * Fetches a sample build event allowing you to customize specified attributes.
 *
 * @param {object} build - An object used to override baseline build object.
 * @param {object} buildMetadata - This is the event envelope which will contain build as its member.
 * @return {object} - An object of the structure `{event: 'ready', build}`.
 */
function getTestBuildEvent(build, buildMetadata) {
  build = build || {};
  buildMetadata = buildMetadata || {};
  const baseline = {
    id: 'build 1',
    createdAt: '2016-02-27T05:44:46.947Z',
    project: {
      id: 'project 1',
      organization: {
        id: organizationId1,
        subscription: {
          rules: {},
        },
      },
    },
    branch: {
      name: 'branch 1',
    },
    diskSpace: {
      realBytes: server.gigabytesToBytes(0.5),
      virtualBytes: server.gigabytesToBytes(1),
    },
    container: {
      id: 'some container',
    },
  };
  return _.merge({build: _.merge(baseline, build), event: 'ready'}, buildMetadata);
}

function setUpDbApiResponses(responses, organization) {
  organization = organization || organizationId1;
  responses.forEach(response => {
    nock('http://localhost:9876')
      .get(`/organization/${organization}/disk-usage`)
      .reply(200, '"' + response + '"');
  });
}

function getByteCountRamp(num) {
  let gb = 0.0;
  let ramp = [];
  for (let i = 0; i < num; i++) {
    gb += 0.5;
    ramp.push(server.gigabytesToBytes(gb));
  }
  return ramp;
}
function getEventCounter(count, done) {
  var counter = 0;
  return function() {
    counter++;
    if (counter === count) {
      done();
    }
  };
}


describe('Server', function() {
  const containerManagerUrl = 'http://localhost:9631';

  describe('event storage', function() {
    beforeEach(function(done) {
      memdown.clearGlobalStore();
      stream = through2.obj();
      storage = levelup('./test', {db: memdown});
      producer = new eventbus.plugins.Memory.Producer({stream});
      logStorage = [];

      let logStream = through2(function(data, enc, cb) {
        logStorage.push(JSON.parse(data.toString()));
        cb(null, data);
      });
      var options = {
        level: storage,
        consumer: new eventbus.plugins.Memory.Consumer({stream}),
        log: bunyan.createLogger({name: 'reaper-tests', streams: [{stream: logStream, level: 'debug'}]}),
        apiServerHost: 'localhost',
        apiServerPort: 0,
        containerManagerUrl,
        dbUrl: 'http://localhost:9876',
      };
      server = new Server(options);
      server.start(done);
    });
    afterEach(function(done) {
      server.stop(done);
    });
    it('should export data', function(done) {
      let ramp = getByteCountRamp(1);
      setUpDbApiResponses(ramp);
      producer.stream.write(getTestBuildEvent());
      server.on('buildReceived', function() {
        const address = server.server.address();
        request(`http://${address.address}:${address.port}/api/export-data`, function(error, response, body) {
          should.not.exist(error);
          response.statusCode.should.equal(200);
          body = body.split('\n');
          JSON.parse(body[0]).key.should.equal('build!!build 1');
          JSON.parse(body[1]).key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 1');
          JSON.parse(body[2]).key.should.equal(`organization_build!!${organizationId1}!!2016-02-27T05:44:46.947Z!!build 1`);
          JSON.parse(body[3]).key.should.equal('project_branch_build!!project 1!!branch 1!!2016-02-27T05:44:46.947Z!!build 1');
          done();
        });
      });
    });
    it('should store builds indexed by build id, date, organization, and branch', function(done) {
      let ramp = getByteCountRamp(2);
      setUpDbApiResponses(ramp);
      producer.stream.write(getTestBuildEvent());
      producer.stream.write(getTestBuildEvent({id: 'build 2', project: {id: 'project 2'}}));
      server.on('buildReceived', getEventCounter(2, function() {
        server.getKeyAndValueArray('!', '~', function(error, records) {
          should.exist(server);
          records.length.should.equal(8);
          records[0].key.should.equal('build!!build 1');
          records[1].key.should.equal('build!!build 2');
          records[2].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 1');
          records[3].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 2');
          records[4].key.should.equal(`organization_build!!${organizationId1}!!2016-02-27T05:44:46.947Z!!build 1`);
          records[5].key.should.equal(`organization_build!!${organizationId1}!!2016-02-27T05:44:46.947Z!!build 2`);
          records[6].key.should.equal('project_branch_build!!project 1!!branch 1!!2016-02-27T05:44:46.947Z!!build 1');
          records[7].key.should.equal('project_branch_build!!project 2!!branch 1!!2016-02-27T05:44:46.947Z!!build 2');
          done();
        });
      }));
    });
    it('should clean up builds stored when reap events occur', function(done) {
      let ramp = getByteCountRamp(2);
      setUpDbApiResponses(ramp);
      producer.stream.write(getTestBuildEvent());
      producer.stream.write(getTestBuildEvent({id: 'build 2', project: {id: 'project 2'}}));
      server.on('buildReceived', getEventCounter(2, function() {
        server.getKeyAndValueArray('!', '~', function(error, records) {
          let reapReceived = false;
          server.on('reapReceived', () => { reapReceived = true;});
          should.exist(server);
          records.length.should.equal(8);
          records[0].key.should.equal('build!!build 1');
          records[1].key.should.equal('build!!build 2');
          producer.stream.write(getTestBuildEvent(false, {event: 'reaped'}));
          server.getKeyAndValueArray('!', '~', function(error, records) {
            should.exist(server);
            reapReceived.should.equal(true);
            records.length.should.equal(4);
            records[0].key.should.equal('build!!build 2');
            done();
          });
        });
      }));
    });
    it('should query for individual records', function(done) {
      let ramp = getByteCountRamp(2);
      setUpDbApiResponses(ramp);
      producer.stream.write(getTestBuildEvent());
      producer.stream.write(getTestBuildEvent({id: 'build 3'}));
      server.on('buildReceived', getEventCounter(2, function() {
        server.getValuesArray('build!!!', 'build!!~', function(error, results) {
          results.length.should.equal(2);
          JSON.stringify(results[0]).should.equal(JSON.stringify(getTestBuildEvent().build));
          done(error);
        });
      }));
    });
    it('should reap all but the most recent X builds on a branch based on configuration', function(done) {
      let ramp = [
        server.gigabytesToBytes(0.5),
        server.gigabytesToBytes(0.5),
        server.gigabytesToBytes(1),
        server.gigabytesToBytes(1),
        server.gigabytesToBytes(1),
        server.gigabytesToBytes(1),
      ];
      setUpDbApiResponses(ramp);
      producer.stream.write(getTestBuildEvent({id: 'build 1', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 2', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 3', createdAt: '2016-02-03T05:44:46.947Z', branch: {name: 'branch 2'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 4', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 2'}}));
      var project = {
        id: 'project 1',
        organization: {
          id: organizationId2,
          subscription: {
            rules: {
              perBranchBuildLimit: 3,
              diskSpace: -1,
            },
          },
        },
      };
      producer.stream.write(getTestBuildEvent({id: 'build 5', createdAt: '2016-02-05T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      producer.stream.write(getTestBuildEvent({id: 'build 6', createdAt: '2016-02-06T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      producer.stream.write(getTestBuildEvent({id: 'build 7', createdAt: '2016-02-07T05:44:46.947Z', branch: {name: 'branch 3'}, project}));
      var lastBranch3Build = getTestBuildEvent({id: 'build 8', createdAt: '2016-02-08T05:44:46.947Z', branch: {name: 'branch 3'}, project});
      producer.stream.write(lastBranch3Build);
      var lastBranch1Build = getTestBuildEvent({id: 'build 9', createdAt: '2016-03-09T05:44:46.947Z', branch: {name: 'branch 1'}});
      producer.stream.write(lastBranch1Build);
      var lastBranch2Build = getTestBuildEvent({id: 'build 10', createdAt: '2016-02-10T05:44:46.947Z', branch: {name: 'branch 2'}});
      producer.stream.write(lastBranch2Build);
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
      const project = {
        id: 'project 2',
        organization: {
          id: organizationId2,
          subscription: {
            rules: {
              diskSpace: 2,
              perBranchBuildLimit: -1,
            },
          },
        },
      };

      let ramp = getByteCountRamp(3);
      setUpDbApiResponses(ramp);

      ramp = [
        server.gigabytesToBytes(0.5),
        server.gigabytesToBytes(1),
        server.gigabytesToBytes(1.5),
        server.gigabytesToBytes(2),
        server.gigabytesToBytes(2.5),
        server.gigabytesToBytes(2.5),
        server.gigabytesToBytes(2.5),
        server.gigabytesToBytes(2.5),
        server.gigabytesToBytes(2.5),
      ];
      setUpDbApiResponses(ramp, organizationId2);

      producer.stream.write(getTestBuildEvent({id: 'build 1', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 2', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 2'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 3', createdAt: '2016-02-03T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 4', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 5', createdAt: '2016-02-04T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 6', createdAt: '2016-02-05T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 7', createdAt: '2016-02-06T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 8', createdAt: '2016-02-07T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 9', createdAt: '2016-02-08T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 10', createdAt: '2016-02-09T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 11', createdAt: '2016-02-10T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 12', createdAt: '2016-02-11T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      server.on('enforcementComplete', getEventCounter(12, function(triggeringBuild) {
        setTimeout(function() {
          var tasks = {
            allBuilds: server.getKeyAndValueArray.bind(server, 'build!!!', 'build!!~'),
            organization1: server.getOrganizationBuilds.bind(server, organizationId1),
            organization2: server.getOrganizationBuilds.bind(server, organizationId2),
          };
          async.parallel(tasks, function(error, results) {
            should.not.exist(error);
            results.allBuilds.length.should.equal(6);
            results.organization1.length.should.equal(2);
            results.organization2.length.should.equal(4);
            done();
          });
        }, 200);
      }));
    });
    it('should not reap pinned builds based on branch limits', function(done) {
      const projectOne = {
        id: 'project 1',
        organization: {
          id: organizationId2,
          subscription: {
            rules: {
              perBranchBuildLimit: 1,
              diskSpace: -1,
            },
          },
        },
      };
      const projectTwo = {
        id: 'project 1',
        organization: {
          id: organizationId2,
          subscription: {
            rules: {
              perBranchBuildLimit: 2,
              diskSpace: -1,
            },
          },
        },
      };

      const buildData = [
        {id: 'build 01', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}, project: projectOne, pinned: true},
        {id: 'build 02', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 1'}, project: projectOne, pinned: false},
        {id: 'build 03', createdAt: '2016-02-03T05:44:46.947Z', branch: {name: 'branch 2'}, project: projectOne},
        {id: 'build 04', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 2'}, project: projectOne, pinned: true},
        {id: 'build 05', createdAt: '2016-02-05T05:44:46.947Z', branch: {name: 'branch 3'}, project: projectTwo, pinned: true},
        {id: 'build 06', createdAt: '2016-02-06T05:44:46.947Z', branch: {name: 'branch 3'}, project: projectTwo},
        {id: 'build 07', createdAt: '2016-02-07T05:44:46.947Z', branch: {name: 'branch 3'}, project: projectTwo},
        {id: 'build 08', createdAt: '2016-02-08T05:44:46.947Z', branch: {name: 'branch 3'}, project: projectTwo},
        {id: 'build 09', createdAt: '2016-03-09T05:44:46.947Z', branch: {name: 'branch 1'}, project: projectOne},
        {id: 'build 10', createdAt: '2016-02-10T05:44:46.947Z', branch: {name: 'branch 2'}, project: projectOne},
      ];
      const builds = _.map(buildData, getTestBuildEvent);

      builds.forEach(function(build) {
        producer.stream.write(build);
      });

      server.on('enforcementComplete', getEventCounter(10, function(triggeringBuild) {
        async.map([builds[8].build, builds[9].build, builds[7].build], server.getProjectBranchBuilds.bind(server), function(error, results) {
          results[0][0].value.id.should.equal('build 01');
          results[0][1].value.id.should.equal('build 09');
          results[0].length.should.equal(2);
          results[1][0].value.id.should.equal('build 04');
          results[1][1].value.id.should.equal('build 10');
          results[1].length.should.equal(2);
          results[2][0].value.id.should.equal('build 05');
          results[2][1].value.id.should.equal('build 07');
          results[2][2].value.id.should.equal('build 08');
          results[2].length.should.equal(3);
          done();
        });
      }));
    });
    it('should not reap builds matching an exempted pattern', function(done) {
      var project = {
        id: 'project 2',
        organization: {
          id: organizationId2,
          subscription: {
            rules: {
              diskSpace: 2,
              perBranchBuildLimit: -1,
            },
          },
        },
      };
      server.limitRuleExclutions = [
        {
          name: 'kids eat free',
          pattern: {
            project: {
              organization: {
                id: organizationId2,
              },
            },
          },
        },
      ];

      let ramp = getByteCountRamp(3);
      setUpDbApiResponses(ramp);

      producer.stream.write(getTestBuildEvent({id: 'build 1', createdAt: '2016-02-01T05:44:46.947Z', branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 2', createdAt: '2016-02-02T05:44:46.947Z', branch: {name: 'branch 2'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 3', createdAt: '2016-02-03T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 4', createdAt: '2016-02-04T05:44:46.947Z', branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 5', createdAt: '2016-02-04T05:44:46.947Z', project, branch: {name: 'branch 1'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 6', createdAt: '2016-02-05T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 7', createdAt: '2016-02-06T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 8', createdAt: '2016-02-07T05:44:46.947Z', project, branch: {name: 'branch 4'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 9', createdAt: '2016-02-08T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 10', createdAt: '2016-02-09T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 11', createdAt: '2016-02-10T05:44:46.947Z', project, branch: {name: 'branch 3'}}));
      producer.stream.write(getTestBuildEvent({id: 'build 12', createdAt: '2016-02-11T05:44:46.947Z', project, branch: {name: 'branch 5'}}));
      server.on('enforcementComplete', getEventCounter(12, function(triggeringBuild) {
        setTimeout(function() {
          var tasks = {
            allBuilds: server.getKeyAndValueArray.bind(server, 'build!!!', 'build!!~'),
            organization1: server.getOrganizationBuilds.bind(server, organizationId1),
            organization2: server.getOrganizationBuilds.bind(server, organizationId2),
          };
          async.parallel(tasks, function(error, results) {
            should.not.exist(error);
            results.organization2.length.should.equal(9);
            results.allBuilds.length.should.equal(11);
            results.organization1.length.should.equal(2);
            let build12Message = logStorage.pop();
            build12Message.buildId.should.equal('build 12');
            build12Message.msg.should.containEql('build 12');
            build12Message.msg.should.containEql('kids eat free');
            done();
          });
        }, 200);
      }));
    });
    it('should reap builds whose pull requests have been closed');
    it('should reap all builds older than a conifgurable time window');
    // TODO: When should we check? Ideally we subscribe to provider (github/bitbucket) events but we could miss one so
    // we may need/want to perform some kind of "true-up".
    it('should delete all environments for a pull request that has been closed');
  });
});
