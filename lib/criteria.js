/* eslint no-console: 0, guard-for-in: 0 */
'use strict';

var _ = require('lodash');

var reapedReasons = require('./constants');

const PR_STATE_OPEN = 'open';
const PR_STATE_CLOSED = 'closed';
const PR_STATES = [PR_STATE_OPEN, PR_STATE_CLOSED];
const PR_DEFAULT_STATE = PR_STATE_OPEN;

/**
 * Applies reaping criteria to a project's containers.
 *
 * @param Project project - the project to apply criteria to
 * @param Object criteria - reaping criteria to apply.
 *
 * @returns Object - Object with `remove` and `keep` properties which
 * are arrays of container ids.
 */
function applyCriteria(project, criteria) {
  let result = {
    remove: [],
    keep: [],
  };

  if (!project || !criteria) {
    throw new TypeError('project and criteria are required.');
  }

  if (criteria.pullRequest) {
    PR_STATES.forEach(function(state) {
      result = applyPullRequestCriteria(project, state, criteria, result);
    });
  }

  if (criteria.branch) {
    project.branches.forEach(function(branch) {
      result = applyBranchCriteria(project, branch, criteria, result);
    });
  }

  // Shift pinned builds from the remove array to the keep array.
  // Never remove pinned builds based on the number of builds on a PR
  // or branch.
  result.keep = result.keep.concat(_.filter(result.remove, function(item) {
    return item.pinned;
  }));

  // ensure that if something is in 'keep', we remove it from 'remove'
  // because it's possible for a container to be in both.
  result.remove = _.differenceBy(result.remove, result.keep, function(obj) {
    return obj.container.id;
  });

  return result;
}

function applyBranchCriteria(project, branch, criteria, result) {
  let max;
  try {
    max = criteria.branch.max;
  }
  catch (e) {
    return result;
  }

  if (!Number.isNaN(max)) {
    console.log('Applying Branch max:', max);
    console.log('Branch:', branch.branch);
    result = merge(result, applyMax(branch.builds, max, reapedReasons.REAPED_REASON_BRANCH_BUILDS));
  }
  return result;
}

function applyPullRequestCriteria(project, state, criteria, result) {
  let stateCriteria;
  let max;
  try {
    stateCriteria = criteria.pullRequest[state];
    max = Number(stateCriteria.max);
  }
  catch (e) {
    return result;
  }
  if (stateCriteria && !isNaN(max)) {
    console.log(`Applying ${state.toUpperCase()} PR max: ${stateCriteria.max}`);

    let prsInState = project.pullRequests.filter(function(pr) {
      if (PR_STATES.indexOf(state) < 0) {
        throw new TypeError(`state must be one of ${PR_STATES}, found: ${state}`);
      }

      // If a PR does not have a state it is assumed to be in the default
      // state.
      let myState = pr.state ? pr.state : PR_DEFAULT_STATE;
      return myState === state;
    });

    prsInState.forEach(function(pr) {
      console.log('PR:', pr.pr, pr.state);
      let reason = reapedReasons.REAPED_REASON_PR_BUILDS;
      if (pr.state === PR_STATE_CLOSED) {
        reason = reapedReasons.REAPED_REASON_PR_CLOSED;
      }
      result = merge(result, applyMax(pr.builds, stateCriteria.max, reason));
    });
  }
  return result;
}

/**
 * Merges two objects that have array properties together and removes duplicates
 * in those arrays. Each array element is assumed to be an object with an 'id'
 * property, which is used for uniquenss tests.
 *
 * @param Object existing - object to merge the other object into.
 * Modified in place and returned.
 *
 * @param Object current - new object to merge into existing object.
 *
 * @returns Object - the first argument ('existing')
 */
function merge(existing, current) {
  for (let key in current) {
    existing[key] = _.uniqBy(_.union(existing[key], current[key]), 'id');
  }
  return existing;
}

function applyMax(array, max, reason) {
  if (!array) {
    throw new Error('Array argument required');
  }
  if (typeof max != 'number' || max < 0) {
    throw new Error('Invalid max pull requests criteria value: ' + max);
  }

  let pinned = array.filter(function(item) {
    return item.pinned;
  });
  let unpinned = array.filter(function(item) {
    return !item.pinned;
  });
  let applied = {
    remove: unpinned.slice(max),
    keep: pinned.concat(unpinned.slice(0, max)),
  };

  applied.remove.forEach(function(obj) {
    obj.reason = reason;
  });

  return applied;
}


module.exports = {
  apply: applyCriteria,
  applyMax,
  merge,
};
