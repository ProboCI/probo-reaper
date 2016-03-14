'use strict';

var fs = require('fs');
var Promise = require('bluebird');
var GitHubApi = require('github');

var utils = require('./utils');

var defaultErrorState = null;

// cache for pull request statuses
var prCache = {};

var github = new GitHubApi({
  version: '3.0.0',
  headers: {
    // GitHub requires a unique user agent
    'user-agent': 'Probo',
  },
});
Promise.promisifyAll(github.pullRequests);

function* getPRStatus(project, pr) {
  var prSlug = utils.slugify.projectPr(project, pr);

  if (!prCache[prSlug]) {
    github.authenticate({type: 'oauth', token: project.service_auth.token});

    let pullRequest;
    try {
      // get list of pull requests for the project
      console.log('getting Github PR status for project ' + project.slug, 'pr', pr);
      pullRequest = yield github.pullRequests.getAsync({
        user: project.owner,
        repo: project.repo,
        number: pr,
      });
    }
    catch (e) {
      console.log(e);
      // there was a problem getting the status update for this PR, default to
      // an object so we don't keep trying

      pullRequest = {
        number: +pr,
        state: defaultErrorState,
      };
    }

    // create a map from PR number to PR object
    prCache[prSlug] = pullRequest;
    console.log(utils.json(pullRequest))
  }

  var pullRequest = prCache[prSlug];
  return pullRequest ? pullRequest.state : null;
}

module.exports = {
  getPRStatus,
  github,

  savePrCache(filename) {
    try {
      fs.writeFileSync(filename, JSON.stringify(prCache));
    }
    catch (e) {
      console.error('failed to save pr cache:', e.message);
    }
  },
  loadPrCache(filename) {
    try {
      prCache = JSON.parse(fs.readFileSync(filename));
    }
    catch (e) {
      console.error('failed to load pr cache:', e.message, '. Will build it at runtime');
    }
  },
};
