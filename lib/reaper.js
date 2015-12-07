/* eslint no-console: 0, no-inline-comments: 1, guard-for-in: 0 */
'use strict';

var co = require('co');

var utils = require('./utils');
var criteria = require('./criteria');
var github = require('./github');
var ContainerManager = require('./container_manager');

 // will be filled in on startup
var proboConfig;

const DEFAULT_CRITERIA = {
  pullRequest: {
    open: {
      max: 1, // 2 containers per open PR
    },
    closed: {
      max: 0, // no containers for closed PRs
    },
  },
  branch: {
    max: 1,   // 2 containers per branch
  },
};


/**
 * Returns an array of projects.
 * Each project has .builds, .prs, and .branches arrays.
 * The builds array is all the builds for the project, sorted by createdAt date,
 *   descending.
 * The prs array is all the PRs, sorted by PR number, descending.
 *   Each object is {pr, builds, state}. State is GH info for the PR,
 *   if it's a GH project.
 * The branches array is all the builds for a particular branch,
 *   sorted by createdAt in descending order. Each object is {branch, builds}
 */
function* buildsToProjects(builds) {
  var projects = {};

  for (let build of builds) {
    // console.log(JSON.stringify(build, null, 2))
    let project = projects[build.project.slug];
    if (!project) {
      project = projects[build.project.slug] = build.project;

      // put builds into builds and PR and branch buckets
      project.builds = [];
      project.pullRequests = [];
      project.branches = [];

      // ensure there's a reaperCriteria set on the project, defaut if necessary
      project.reaperCriteria = project.reaperCriteria || DEFAULT_CRITERIA;
    }
    delete build.project;
    project.builds.push(build);

    // turn pr and branch into a string to avoid undefined values
    build.pullRequest = build.pullRequest + '';
    build.branch = build.branch + '';
  }

  let createdAtDesc = utils.sorter('createdAt', 'desc');

  // turn projects back into an array
  var projectArray = [];
  for (let projectName in projects) {
    let project = projects[projectName];

    // sort the builds by descending start date
    project.builds.sort(createdAtDesc);

    // turn PRs into an array
    let prs = utils.indexBy(project.builds, 'pullRequest');
    // console.log(prs)
    for (let pr in prs) {
      let pullRequest = {
        pr: pr,
        builds: prs[pr],
      };
      if (project.provider.slug === 'github') {
        pullRequest.state = yield* github.getPRStatus(project, pr);
      }

      // sort the builds in the PR
      pullRequest.builds.sort(createdAtDesc);

      project.pullRequests.push(pullRequest);
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
  var projects = yield* buildsToProjects(builds); // list of projects each with a builds array

  for (let project of projects) {
    console.log(`Project ${project.id} ${project.slug} [${project.provider.slug}]`);
    // utils.printBuilds(project.builds);
    utils.printPRs(project.pullRequests);
    utils.printBranches(project.branches);

    // returns {remove, keep} arrays of container IDs to remove and keep, respectively
    let containerActions = criteria.apply(project, project.reaperCriteria);
    console.log(containerActions);
    for (let containerId of containerActions.remove) {
      console.log('removing container', containerId);

      if (proboConfig.dryrun) {
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


module.exports.run = co.wrap(function* (config) {
  proboConfig = config;

  try {
    yield start();
  }
  catch (e) {
    console.error(e.stack);
  }
});

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
