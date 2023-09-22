'use strict';

const ContainerManager = require('./ContainerManager');
const criteria = require('./criteria');
const Transform = require('./Transform');
const utils = require('./utils');

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

class Reaper {

  constructor(config) {
    this.config = config;
    this.criteria = config.reaperCriteria || DEFAULT_CRITERIA;

    this.transform = new Transform(config);
    this.containerManager = new ContainerManager({url: `http://${config.cmHostname}:${config.cmPort}`});
    this.printer = new utils.Printer({outputFormat: config.outputFormat});
  }

  /**
   * Starts the reaping process.
   */
  async run() {

    // Gets the builds from the container manager.
    const builds = await this.containerManager.getBuilds();
    const projects = await this.transform.buildsToProjects(builds);


    return this.reap(this._getActions(projects));
  }

  /**
   * Returns an array of {remove, keep} objects for each given project in the
   * array.
   *
   * @param {Object.<string, any>} projects - An object with all the projects.
   */
  _getActions(projects) {

    let projectActions = [];

    for (let projectName in projects) {
      let project = projects[projectName];

      this.printer.printProject(project);
      this.printer.printPRs(project.pullRequests);

      // Returns {remove, keep} arrays of container IDs to remove and keep, respectively
      let containerActions = criteria.apply(project, this.criteria);

      projectActions.push(containerActions);
    }

    return projectActions;
  }

  /**
   * Reaps builds. Must be implemented by children.
   */
  async reap(projectActions) {}

  /**
   * Deletes a build (and its container).
   *
   * @param {Object.<string, any>} build - The build object.
   */
  async _deleteBuild(build) {
    try {
      let response = await this.containerManager.deleteBuild(build.id, build.reason);
      if (response.error) {
        console.log(`An error occurred and build ${build.id} was not properly reaped.`, response);
      }

      console.log(`Removed container: ${build.container.id}, for build ${build.id}, because: ${build.reason.description}`);
    }
    catch(error) {
      console.log(`An error occurred and build ${build.id} could not be reaped.`, error);
    }
  }

  bytesToGigabytes(bytes) {
    return bytes / BYTES_IN_GB;
  }

}


module.exports = Reaper;
