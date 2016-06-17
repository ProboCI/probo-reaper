/* eslint no-console: 0, no-inline-comments: 1, guard-for-in: 0 */
'use strict';

var co = require('co');

var utils = require('./utils');
var criteria = require('./criteria');
var ContainerManager = require('./container_manager');
var request = require('request');
var querystring = require('querystring');
var Promise = require('bluebird');

 // will be filled in on startup
var proboConfig;

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
  // branch: {
  //   // containers per branch
  //   max: 1,
  // },
};


/**
 * Returns an array of projects.
 * Each project has .builds, .prs, and .branches arrays.
 * The builds array is all the builds for the project, sorted by createdAt date,
 *   descending.
 * The prs array is all the PRs, sorted by PR number, descending.
 *   Each object is {pr, builds, state}. State is 'open', 'closed', or null.
 *   if it's a GH project.
 * The branches array is all the builds for a particular branch,
 *   sorted by createdAt in descending order. Each object is {branch, builds}
 *
 * @param {Array} builds - list of builds from container manager
 * @return {Array} Array of projects created from builds.
 */
function* buildsToProjects(builds) {
  var projects = {};

  for (let build of builds) {
    let projectSlug = `${build.project.provider.slug}/${build.project.slug}`;
    let project = projects[projectSlug];
    if (!project) {
      project = projects[projectSlug] = build.project;

      // put builds into builds and PR and branch buckets
      project.builds = [];
      project.pullRequests = [];
      project.branches = [];

      // ensure there's a reaperCriteria set on the project, defaut if necessary
      project.reaperCriteria = project.reaperCriteria || DEFAULT_CRITERIA;
    }
    project.builds.push(build);

    // link project back to the build
    build._project = project;

    // turn pr and branch into a string to avoid undefined values
    // Need to support old-style .pullRquest (string) and new-style
    // .pullRequest.number (string) formats (there was no migration for the leveldb DB)

    build.pullRequest = typeof build.pullRequest == 'object' ? build.pullRequest.number : build.pullRequest + '';
    build.branch = typeof build.branch == 'object' ? build.branch.name : build.branch + '';

    // handle cases where build.container.disk isn't set
    build.container.disk = build.container.disk || {};
  }

  let createdAtDesc = utils.sorter('createdAt', 'desc');


  var requester = Promise.promisify(function(url, project, pr, done) {
    var uri = `pull-request/${project.owner}/${project.repo}/${pr}`;
    var query = querystring.stringify(project.service_auth);
    request(`${url}/${uri}?${query}`, {json: true}, function(error, response, body) {
      try {
        var state = (body.state && body.state) ? body.state : null;
        done(error, state);
      }
      catch (err) {
        done(err);
      }
    });
  });

  // turn projects back into an array
  var projectArray = [];
  for (let projectName in projects) {
    let project = projects[projectName];

    // sort the builds by descending start date
    project.builds.sort(createdAtDesc);

    // turn PRs into an array
    let prs = utils.indexBy(project.builds, 'pullRequest');
    for (let pr in prs) {
      let pullRequest = {
        pr: pr,
        builds: prs[pr],
      };

      var url = null;
      for (let handlerName in proboConfig.codeHostingHandlers) {
        let regex = new RegExp(handlerName);
        if (regex.test(project.provider.slug)) {
          url = proboConfig.codeHostingHandlers[handlerName];
          break;
        }
      }
      if (url === null) {
        console.log(`[WARNING] - Unsupported provider slug \`${project.provider.slug}\` encountered while checking pull request ${pr.id} for \`${project.provider.slug}-${project.name}\``);
      }
      else {
        pullRequest.state = yield requester(url, project, pr);
      }


      // sort the builds in the PR
      pullRequest.builds.sort(createdAtDesc);

      project.pullRequests.push(pullRequest);

      // link PR back in build
      pullRequest.builds.forEach(function(build) {
        build._pr = pullRequest;
      });

      // calculate the total build size for the project
      pullRequest.totalBuildSize = pullRequest.builds.reduce(function(prev, build) {
        var buildSize = build.container.disk.containerSize;
        if (build.container.state === 'removed') {
          // do not count removed containers
          buildSize = 0;
        }
        return prev + buildSize;
      }, 0);
    }

    // turn branches into an array
    let branches = utils.indexBy(project.builds, 'branch');
    for (let branch in branches) {
      project.branches.push({
        branch: branch,
        // sort the builds in the branch
        builds: branches[branch].sort(createdAtDesc),
      });
    }

    // sort by descending PR number
    project.pullRequests.sort(utils.sorter('pr', 'desc'));

    projectArray.push(project);
    delete project._temp;
  }

  return projectArray;
}


function* start() {
  var cm = new ContainerManager({url: `http://${proboConfig.hostname}:${proboConfig.port}`});

  // list all builds
  var builds = yield* cm.getBuilds();
  // list of projects each with a builds array:
  var projects = yield* buildsToProjects(builds);

  var printer = new utils.Printer({outputFormat: proboConfig.outputFormat});

  if (proboConfig.status === true) {
    printer.printBuilds(builds);
  }
  else {
    for (let project of projects) {
      printer.printProject(project);
      // printer.printBuilds(project.builds);
      printer.printPRs(project.pullRequests);
      printer.printBranches(project.branches);

      // returns {remove, keep} arrays of container IDs to remove and keep, respectively
      let containerActions = criteria.apply(project, project.reaperCriteria);
      console.log('container actions:', containerActions);
      for (let containerId of containerActions.remove) {
        console.log('removing container', containerId);

        if (proboConfig['dry-run']) {
          console.log(`DRY RUN: container ${containerId} NOT being removed`);
        }
        else {
          let resp = yield* cm.removeContainer(containerId);
          console.log(resp);
        }
        console.log(`removed container  ${containerId}`);
      }
    }
  }
}


module.exports = {
  start: start,
  buildsToProjects: buildsToProjects,

  run: co.wrap(function* (config) {
    proboConfig = config;

    try {
      yield start();
    }
    catch (e) {
      console.error(e.stack);
    }
  }),
};
