'use strict';

var read = require('co-read');
var through2 = require('through2');
var JSONStream = require('JSONStream');
var request = require('request');
var requestAsync = require('request-promise');
var _ = require('lodash');
var co = require('co');

/**
 * Class to interact with with a container manager
 * @class
 */
class ContainerManager {

  /**
   * Constructor
   * @param {Object} config - Config object
   * @param {string} config.url - URL (proto://host:port) for the Container manager
   */
  constructor(config) {
    this.config = config;
    this.getBuildsPromise = co.wrap(function* (opts) {
      return yield this.getBuilds(opts);
    });
  }

  /**
   * @param {Object} [opts] - Options object
   * @param {boolean} [opts.all=false] - if true, fetch all builds, whether an container exists for the build or not. By default, only returns builds that have an existing container
   * @return {Array} a list of build objects with just the necessary attributes
   */
  *getBuilds(opts) {
    opts = opts || {};
    var query = `${opts.all ? 'all=true' : ''}`;
    var buildStream = request(`${this.config.url}/builds?${query}`).pipe(new JSONStream.parse('*'));
    var build;
    var builds = [];

    // Parse out just what we need and filter
    // TODO - Should we really do this? If the data changes we have to
    // explicitly white list the new properties.
    buildStream = buildStream.pipe(through2.obj(function(build, enc, callback) {
      if (build.container) {
        this.push(_.pick(build, [
          'id',
          'ref',
          'branch',
          'pullRequest',
          'project',
          'container',
          'createdAt',
          'pinned',
        ]));
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

    let containerNames = response.containers.filter(function(c) {
      return c.name.indexOf(`probo--${project.name.replace('/', '.')}--${project.id}`) === 0;
    }).map(function(c) {
      return c.name;
    });

    return containerNames;
  }

  /**
   * @param {string} containerId - The id of the build to reap.
   * @param {Object} reason - Reason object
   * @param {string} config.constant - URL (proto://host:port) for the Container manager
   * @param {string} config.description - Human readable descrition of the reason to perform the reap.
   * */
  *removeContainer(containerId, reason) {
    var response;
    try {
      const options = {
        url: `${this.config.url}/containers/${containerId}`,
        qs: {
          reason: reason.constant,
          reasonText: reason.reasonText,
          force: true,
        },
      };
      response = yield requestAsync.del(options);
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
