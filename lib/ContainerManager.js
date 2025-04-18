'use strict';

const _ = require('lodash');
const JSONStream = require('JSONStream');
const request = require('request');
const requestAsync = require('request-promise');
const through2 = require('through2');

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
  }

  /**
   * @param {Object.<string, any>} [opts] - Options object
   * @param {boolean} [opts.all=false] - if true, fetch all builds, whether an
   *   the build is deleted or not. By default, only returns active builds
   */
  async getBuilds(opts) {
    opts = opts || {};
    var query = `${opts.all ? 'all=true' : ''}`;
    var buildStream = request(`${this.config.url}/builds?${query}`).pipe(new JSONStream.parse());
    var builds = [];

    console.log(opts);

    // Parse out just what we need and filter
    // TODO - Should we really do this? If the data changes we have to
    // explicitly white list the new properties.
    return new Promise(resolve => {
      var startDate;
      var buildDate;
      var todaysDate = 1744124717000;
      var newBuilds = [];

      buildStream.pipe(through2.obj(function(build, enc, callback) {
        build.forEach(element => {
          startDate = new Date(element.createdAt);
          buildDate = startDate.getTime();
          if (buildDate > todaysDate) {
            if (element.project.provider.slug !== 'gitlab') {
              newBuilds.push(element);
            }
          }
        });
        build = newBuilds;

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

        builds.push(build);

        callback();
      }))
      .on('finish', () => {
        return resolve(builds);
      });

    });
  }

  /**
   * @param {string} buildId - The id of the build to reap.
   * @param {Object} reason - Reason object
   * @param {string} config.constant - URL (proto://host:port) for the Container manager
   * @param {string} config.description - Human readable descrition of the reason to perform the reap.
   * */
  async deleteBuild(buildId, reason) {
    var response;
    try {
      const options = {
        url: `${this.config.url}/builds/${buildId}`,
        qs: {
          reason: reason.constant,
          reasonText: reason.reasonText,
          reapedDate: Date.now(),
          force: true,
        },
      };

      response = await requestAsync.del(options);
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
