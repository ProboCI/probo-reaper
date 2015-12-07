/* eslint no-console: 0, guard-for-in: 0 */
'use strict';

var co = require('co');

var utils = require('./utils');
var criteria = require('./criteria');
var github = require('./github');
var ContainerManager = require('./container_manager');

var probo_config; // will be filled in on startup

const DEFAULT_CRITERIA = {
  pull_request: {
    open: {
      max: 1 // 2 containers per open PR
    },
    closed: {
      max: 0 // no containers for closed PRs
    }
  },
  branch: {
    max: 1   // 2 containers per branch
  }
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
function* builds_to_projects(builds) {
  var projects = {};

  for (let build of builds) {
    // console.log(JSON.stringify(build, null, 2))
    let project = projects[build.project.slug];
    if (!project) {
      project = projects[build.project.slug] = build.project;

      // put builds into builds and PR and branch buckets
      project.builds = [];
      project.pull_requests = [];
      project.branches = [];

      // ensure there's a reaper_criteria set on the project, defaut if necessary
      project.reaper_criteria = project.reaper_criteria || DEFAULT_CRITERIA;
    }
    delete build.project;
    project.builds.push(build);

    // turn pr and branch into a string to avoid undefined values
    build.pullRequest = build.pullRequest + '';
    build.branch = build.branch + '';
  }

  let createdAt_desc = utils.sorter('createdAt', 'desc');

  // turn projects back into an array
  var project_array = [];
  for (let project_name in projects) {
    let project = projects[project_name];

    // sort the builds by descending start date
    project.builds.sort(createdAt_desc);

    // turn PRs into an array
    let prs = utils.indexBy(project.builds, 'pullRequest');
    // console.log(prs)
    for (let pr in prs) {
      let pull_request = {
        pr: pr,
        builds: prs[pr]
      };
      if (project.provider.slug === 'github') {
        pull_request.state = yield* github.getPRStatus(project, pr);
      }

      // sort the builds in the PR
      pull_request.builds.sort(createdAt_desc);

      project.pull_requests.push(pull_request);
    }

    // turn branches into an array
    let branches = utils.indexBy(project.builds, 'branch');
    for (let branch in branches) {
      project.branches.push({
        branch: branch,
        // sort the builds in the branch
        builds: branches[branch].sort(createdAt_desc)
      });
    }

    // sort by descending PR number
    project.pull_requests.sort(utils.sorter('pr', 'desc'));

    project_array.push(project);
    delete project._temp;
  }

  return project_array;
}


function* start() {
  var cm = new ContainerManager({url: `http://${probo_config.hostname}:${probo_config.port}`});

  // list all builds
  var builds = yield* cm.getBuilds();
  var projects = yield* builds_to_projects(builds); // list of projects each with a builds array

  for (let project of projects) {
    console.log(`Project ${project.id} ${project.slug} [${project.provider.slug}]`);
    // utils.printBuilds(project.builds);
    utils.printPRs(project.pull_requests);
    utils.printBranches(project.branches);

    // returns {remove, keep} arrays of container IDs to remove and keep, respectively
    let container_actions = criteria.apply(project, project.reaper_criteria);
    console.log(container_actions);
    for (let container_id of container_actions.remove) {
      console.log('removing container', container_id);

      if (probo_config.dryrun) {
        console.log(`DRY RUN: container ${container_id} NOT being removed`);
      }
      else {
        let resp = yield* cm.removeContainer(container_id);
        console.log(resp);
      }
      console.log(`removed container  ${container_id}`);
    }
  }
}


module.exports.run = co.wrap(function* (config) {
  probo_config = config;

  try {
    yield start();
  }
  catch (e) {
    console.error(e.stack);
  }
});

module.exports = {
  start: start,
  builds_to_projects: builds_to_projects,

  run: co.wrap(function* (config) {
    probo_config = config;

    try {
      yield start();
    }
    catch (e) {
      console.error(e.stack);
    }
  })
};
