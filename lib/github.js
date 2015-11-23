var Promise = require('bluebird');
var GitHubApi = require('github');

var utils = require('./utils');

// cache for pull request statuses
var pr_cache = {};

var github = new GitHubApi({
  version: '3.0.0',
  headers: {
    // GitHub requires a unique user agent
    'user-agent': 'Probo'
  }
});
Promise.promisifyAll(github.pullRequests);

function* getPRStatus(project, pr) {
  if (!pr_cache[project.id]) {
    github.authenticate({type: 'oauth', token: project.service_auth.token});

    var pull_requests = [];
    try {
      // get list of pull requests for the project
      console.log('getting Github PR statuses for project ' + project.slug);
      pull_requests = yield github.pullRequests.getAllAsync({
        user: project.owner,
        repo: project.repo,
        // state: 'open'
      });
    } catch (e) {
      console.log(e);
    }

    // create a map from PR number to PR object
    pr_cache[project.id] = utils.indexBy(pull_requests, 'number', true);
  }

  return pr_cache[project.id][pr];
}


module.exports = {
  getPRStatus,
  github
};
