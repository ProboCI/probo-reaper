'use strict';

var read = require('co-read');
var through2 = require('through2');
var JSONStream = require('JSONStream');
var request = require('request');
var requestAsync = require('request-promise');

/**
 * Class to interact with with a container manager
 * @class
 */
class ContainerManager {

  /**
   * Constructor
   * @param Object config - Config object
   * @param String config.url - URL (proto, host, port) for the Container manager
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * @param Object opts - Options object
   * @param boolean opts.all=false - if true, fetch all builds, whether an container exists for the build or not. By default, only returns builds that have an existing container
   */
  *getBuilds(opts) {
    opts = opts || {};
    var query = `${opts.all ? 'all=true' : ''}`;
    var buildStream = request(`${this.config.url}/builds?${query}`).pipe(new JSONStream.parse('*'));
    var build;
    var builds = [];

    // parse out just what we need and filter
    buildStream = buildStream.pipe(through2.obj(function(build, enc, callback) {
      if (build.container) {
        this.push({
          id: build.id,
          ref: build.ref,
          branch: build.branch,
          pullRequest: build.pullRequest,
          project: build.project,
          container: build.container,
          createdAt: build.createdAt
        });
      }

      callback();
    }));

    while ((build = yield read(buildStream))) {
      builds.push(build);
    }

    return builds;
  }

  *getContainerNamesForProject(project) {
    let response = JSON.parse(
      yield requestAsync(`${this.config.url}/containers`)
    );

    let container_names = response.containers.filter(function(c) {
      return c.name.indexOf(`probo--${project.name.replace('/', '.')}--${project.id}`) === 0;
    }).map(function(c) {
      return c.name;
    });

    return container_names;
  }

  *removeContainer(containerId) {
    var response;
    try {
      response = yield requestAsync.del(`${this.config.url}/containers/${containerId}`);
    }
    catch (e) {
      response = e.error;
    }

    try {
      response = JSON.parse(response);
    }
    catch (e) {
      // noop - keep response as is
    }

    return response;
  }
}



module.exports = ContainerManager;
