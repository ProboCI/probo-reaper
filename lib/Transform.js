'use strict';

const Provider = require('./Provider');
const utils = require('./utils');

class Transform {

  /**
   * Constructor.
   *
   * @param {Object.<string, any>} config - The config object.
   * @param {import('./ProboDB')} db - Connection to Probo DB.
   */
  constructor(config) {
    this.config = config;
    this.provider = new Provider(config);
  }

  /**
   * Creates an object with the projectId as key and an project object as value.
   *
   * Each project has .pullRequest object with the branch name as key. Each
   * pull request include a builds array that contains all the builds associated
   * to the pull request. The builds are sorted by the created date.
   *
   * Each pull request object also includes a state, which determines whether a
   * pull request is open or closed.
   *
   * Return value example:
   * ```
   * {
   *   'projectId1': {
   *     ...
   *     pullRequests: [
   *       {
   *         branch: 'a-branch',
   *         state: 'open',
   *         id: 2,
   *         builds: [...],
   *       }
   *     ],
   *     branches: [
   *       {
   *         branch: 'master',
   *         builds: [...],
   *       }
   *     ]
   *   }
   * }
   * ```
   *
   * @param {Array} builds - list of builds from container manager
   * @return {Object.<string, any>} Object of project as in the example above.
   */
  async buildsToProjects(builds) {
    let projects = {};

    for (let build of builds) {
      let project = projects[build.projectId];
      if (!project) {
        projects[build.projectId] = project = build.project;

        // Adds the pull request object to the project.
        project.pullRequests = {};

        // Adds the branches object to the project (builds for active branches).
        project.branches = {};
      }

      const branch = typeof build.branch == 'object' ? build.branch.name : build.branch + '';

      // Builds before https://github.com/ProboCI/probo-reaper/pull/26 did not
      // have a type, so they were pull_request builds.
      if (!build.type || build.type === 'pull_request') {

        if (!project.pullRequests[branch]) {
          project.pullRequests[branch] = {
            branch: branch,
            state: 'open',
            id: build.pullRequest.number,
            diskUsage: 0,
            builds: [],
          };
        }

        project.pullRequests[branch].diskUsage += build.diskSpace.realBytes;

        project.pullRequests[branch].builds.push(build);
      }
      // Else it's a branch build.
      else {
        if (!project.branches[branch]) {
          project.branches[branch] = {
            branch: branch,
            diskUsage: 0,
            builds: [],
          };
        }

        project.branches[branch].diskUsage += build.diskSpace.realBytes;

        project.branches[branch].builds.push(build);
      }
    }

    return this.processProjects(projects);
  }

  /**
   * Transforms project.branches and project.pullRequest objects into arrays
   * and set the state of the pull requests (open or closed). This also sorts
   * the builds for each branch/pull request by creation date.
   */
  async processProjects(projects) {
    for (let project in projects) {
      if (projects.hasOwnProperty(project)) {

        let pullRequests = projects[project].pullRequests;
        let branches = projects[project].branches;

        // Sorts builds, sets state, and transform PRs object to array.
        projects[project].pullRequests = await this.processPullRequests(projects[project], pullRequests);

        // Sorts builds, and transform branches object to array.
        projects[project].branches = await this.processBranches(branches);
      }
    }

    return projects;
  }

  /**
   * Gets the state for each pull requests and sorts the builds.
   *
   * @param {Object.<string, any>} project - The project object.
   * @param {Object.<string, any>} pullRequests - The object of pull requests
   *   including state, id, and builds for each pull request.
   */
  async processPullRequests(project, pullRequests) {

    let prArray = [];

    for (let prName in pullRequests) {

      if (pullRequests.hasOwnProperty(prName)) {

        let pullRequest = pullRequests[prName];

        // Sorts the builds by descending start date.
        pullRequest.builds.sort(utils.sortBuildsByDateDesc);

        // Gets the status of the PR (open, or close).
        pullRequest.state = await this.provider.getPullRequest(project, pullRequest.id);

        prArray.push(pullRequest);
      }

    }

    return prArray;
  }

  /**
   * Transforms the branches object into an array and sorts the builds for each
   * branch by creation date.
   *
   * @param {Object.<string, any>} branches - The object of pull branches
   *   including builds for each branch.
   */
  processBranches(branches) {
    let branchesArray = [];

    for (let branchName in branches) {

      if (branches.hasOwnProperty(branchName)) {

        let branch = branches[branchName];

        // Sorts the builds by descending start date.
        branch.builds.sort(utils.sortBuildsByDateDesc);


        branchesArray.push(branch);
      }

    }

    return branchesArray;
  }

}

module.exports = Transform;
