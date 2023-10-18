'use strict';

const request = require('request-promise');
const querystring = require('querystring');

class Provider {

  constructor(config) {
    this.config = config;
  }

  /**
   * Gets information on a pull request.
   *
   * @param {Object.<string, any>} project - The project object.
   * @param {string} number - The pull request id.
   */
  async getPullRequest(project, number) {
    const path = `/pull-request/${project.owner}/${project.repo}/${number}`;

    let url = this._getHost(project.provider.type);

    let query = project.service_auth;
    query['provider_id'] = project.provider_id;
    query = querystring.stringify(query);

    let res = await request(`${url}${path}?${query}`, {json: true});
    let state = res.state ? res.state : null;

    return state;
  }

  /**
   * Gets the host of the provider.
   *
   * @param {string} provider - The provider handler where we want to make
   *   requests to.
   */
  _getHost(provider) {

    switch(provider) {
      case 'github':
        return this.config.codeHostingHandlers.github;
      case 'gitlab':
        return this.config.codeHostingHandlers.gitlab;
      case 'bitbucket':
        return this.config.codeHostingHandlers.bitbucket;
      default:
        return null;
    }

  }

}

module.exports = Provider;
