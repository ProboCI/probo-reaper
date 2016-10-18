'use strict';

var nock = require('nock');
var should = require('should');

var ContainerManager = require('../lib/container_manager');
var reaper = require('../lib/reaper');
var buildResponse = require('./fixtures/builds.json');
var criteria = require('../lib/criteria');

var config = {
  cmHostname: 'localhost',
  cmPort: 20013,
  codeHostingHandlers: {
    github: 'http://localhost:20014',
    bitbucket: 'http://localhost:20015',
  },
};

nock(`http://${config.cmHostname}:${config.cmPort}`)
  .persist()
  .get('/builds?')
  .reply(200, buildResponse);

nock(`${config.codeHostingHandlers.github}`)
  .persist()
  .get(/\/pull-request\/.*/)
  .reply(200, {state: 'open'});

describe('Reaper', function() {
  describe('Command Line Mode', function() {

    beforeEach(function(done) {
      done();
    });

    afterEach(function(done) {
      done();
    });

    it('should not remove pinned builds', function(done) {
      var error = null;
      should.not.exist(error);
      var cm = new ContainerManager({url: `http://${config.cmHostname}:${config.cmPort}`});
      cm.getBuildsPromise()
        .then(function(data) {
          return data;
        })
        .then(function(builds) {
          return reaper.buildsToProjects(builds, config);
        })
        .then(function(projects) {
          let reapActions = [];
          projects.forEach(function(project) {
            reapActions.push(criteria.apply(project, project.reaperCriteria));
          });
          reapActions.should.be.instanceof(Array).and.have.lengthOf(1);
          let actions = reapActions[0];

          // There are 4 builds in the test data. One is pinned. Therefore there
          // should be 2 marked for removal and 2 marked to keep.
          // Pinned builds should not be counted towards the limit. The default
          // limit is one per PR.
          actions.should.be.instanceof(Object);
          actions.should.have.property('keep');
          actions.should.have.property('remove');
          actions.keep.should.be.instanceof(Array).and.have.lengthOf(2);
          let build = actions.keep[0];
          build.container.id.should.equal('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
          done();
        });
    });
  });
});
