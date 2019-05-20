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

      // ensure there's a reaperCriteria set on the project, default if necessary
      let defaultReaperCriteria = proboConfig.reaperCriteria || DEFAULT_CRITERIA;
      project.reaperCriteria = project.reaperCriteria || defaultReaperCriteria;
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

  var requester = Promise.promisify(function(url, project, pr, done) {
    var uri = `pull-request/${project.owner}/${project.repo}/${pr}`;
    var query = project.service_auth;
    query['provider_id'] = project.provider_id;
    query = querystring.stringify(query);
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
    if (projects.hasOwnProperty(projectName)) {
      let project = projects[projectName];

      // sort the builds by descending start date
      project.builds.sort(utils.sortBuildsByDateDesc);

      // turn PRs into an array
      let prs = utils.indexBy(project.builds, 'pullRequest');
      for (let pr in prs) {
        if (prs.hasOwnProperty(pr)) {
          let pullRequest = {
            pr: pr,
            builds: prs[pr],
          };

          var url = null;

          for (let handlerName in proboConfig.codeHostingHandlers) {
            if (proboConfig.codeHostingHandlers.hasOwnProperty(handlerName)) {
              let regex = new RegExp(handlerName);
              if (regex.test(project.provider.slug)) {
                url = proboConfig.codeHostingHandlers[handlerName];
                break;
              }
            }
          }

          if (url === null) {
            console.log(`[WARNING] - Unsupported provider slug \`${project.provider.slug}\` encountered while checking pull request ${pr.id} for \`${project.provider.slug}-${project.name}\``);
          }
          else {
            pullRequest.state = yield requester(url, project, pr);
          }


          // sort the builds in the PR
          pullRequest.builds.sort(utils.sortBuildsByDateDesc);

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
      }

      // turn branches into an array
      let branches = utils.indexBy(project.builds, 'branch');
      for (let branch in branches) {
        if (branches.hasOwnProperty(branch)) {
          project.branches.push({
            branch: branch,
            // sort the builds in the branch
            builds: branches[branch].sort(utils.sortBuildsByDateDesc),
          });
        }
      }

      // sort by descending PR number
      project.pullRequests.sort(utils.sortPRsByNumberDesc);

      projectArray.push(project);
      delete project._temp;
    }
  }

  return projectArray;
}


function* start() {
  var cm = new ContainerManager({url: `http://${proboConfig.cmHostname}:${proboConfig.cmPort}`});

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
      printer.printPRs(project.pullRequests);
      printer.printBranches(project.branches);

      // returns {remove, keep} arrays of container IDs to remove and keep, respectively
      let containerActions = criteria.apply(project, project.reaperCriteria);
      console.log('container actions:', containerActions);
      for (let buildData of containerActions.remove) {
        console.log('removing environment for build ', buildData.id);
        console.log('reason for reap: ', buildData.reason);

        if (proboConfig['dry-run']) {
          console.log(`DRY RUN: container ${buildData.id} NOT being removed`);
        }
        else {
          let response = yield* cm.removeContainer(buildData.container.id, buildData.reason);
          if (response.error) {
            console.log(`An error occurred and build ${buildData.id} was not properly reaped.`, response);
          }
        }
        console.log(`removed container: ${buildData.container.id}, for build ${buildData.id}, because: ${buildData.reason.description}`);
      }
    }
  }
}


module.exports = {
  start: start,
  buildsToProjects: co.wrap(function* (builds, config) {
    proboConfig = config;
    return yield buildsToProjects(builds);
  }),

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
