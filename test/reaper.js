'use strict';

const nock = require('nock');
const should = require('should');

const buildResponse = require('./fixtures/builds.json');
const ContainerManager = require('../lib/ContainerManager');
const criteria = require('../lib/criteria');
const Transform = require('../lib/Transform');

var config = {
  cmHostname: 'localhost',
  cmPort: 20013,
  codeHostingHandlers: {
    github: 'http://localhost:20014',
    bitbucket: 'http://localhost:20015',
  },
};

const DEFAULT_CRITERIA = {
  pullRequest: {
    open: {
      // containers per open PR
      max: 1,
      maxAge: '',
    },
    closed: {
      // no containers for closed PRs
      max: 0,
    },
  },
};

const transform = new Transform(config);

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
      cm.getBuilds()
        .then(function(data) {
          return data;
        })
        .then(function(builds) {
          return transform.buildsToProjects(builds);
        })
        .then(function(projects) {
          let reapActions = [];

          for (let projectName in projects) {
            let project = projects[projectName];
            reapActions.push(criteria.apply(project, DEFAULT_CRITERIA));
          }

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
