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
      }

      const branch = typeof build.branch == 'object' ? build.branch.name : build.branch + '';
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

    for (let project in projects) {
      if (projects.hasOwnProperty(project)) {

        let pullRequests = projects[project].pullRequests;

        // Sorts builds, sets state, and transform PRs object to array.
        projects[project].pullRequests = await this.processPullRequests(projects[project], pullRequests);
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

}

module.exports = Transform;
