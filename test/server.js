'use strict';

var _ = require('lodash');
var should = require('should');
var levelup = require('levelup');
var memdown = require('memdown');
var eventbus = require('probo-eventbus');
var lib = require('..');
var Server = lib.Server;
var through2 = require('through2');

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
      },
    },
    branch: {
      name: 'branch 1',
    },
    diskSpace: {
      real: 90,
      virtual: 100,
    },
  };
  return {build: _.merge(baseline, object)};
}

describe.only('Server', function() {
  describe('event storage', function() {
    before(function(done) {
      stream = through2.obj();
      storage = levelup('./test', {db: memdown});
      var options = {
        level: storage,
        consumer: new eventbus.plugins.Memory.Consumer({stream}),
      };
      server = new Server(options);
      server.start(done);
    });
    after(function(done) {
      server.stop(done);
    });
    it('should store events', function(done) {
      stream.write(getTestBuildEvent());
      stream.write(getTestBuildEvent({id: 'build 2', project: {id: 'project 2'}}));
      var records = [];
      storage
        .createReadStream()
        .pipe(through2.obj(function(data, enc, cb) {
          records.push(data);
          cb();
        }, function(cb) {
          should.exist(server);
          records.length.should.equal(8);
          records[0].key.should.equal('build!!build 1');
          records[1].key.should.equal('build!!build 2');
          records[2].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 1');
          records[3].key.should.equal('build_date!!2016-02-27T05:44:46.947Z!!build 2');
          records[4].key.should.equal('organization_build!!organization 1!!build 1');
          records[5].key.should.equal('organization_build!!organization 1!!build 2');
          records[6].key.should.equal('project_branch_build!!project 1!!branch 1!!2016-02-27T05:44:46.947Z!!build 1');
          records[7].key.should.equal('project_branch_build!!project 2!!branch 1!!2016-02-27T05:44:46.947Z!!build 2');
          cb();
          done();
        }));
    });
  });
});
