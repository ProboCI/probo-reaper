'use strict';

const Reaper = require('./reaper');

class ReaperCLI extends Reaper {

  /**
   * Reaps all qualified builds.
   *
   * @param {array} projectActions - Array of {remove, keep} objects for each
   *   project. @see `Reaper._getActions()`
   */
  async reap(projectActions) {
    for (let actions of projectActions) {
      console.log('container actions:', actions);

      for (let build of actions.remove) {
        console.log('Removing environment for build ', build.id);
        console.log('Reason for reap: ', build.reason);

        if (this.config.dryRun) {
          console.log(`DRY RUN: container ${build.id} NOT being removed`);
        }
        else {
          return this._deleteBuild(build);
        }
      }
    }

  }
}

module.exports = ReaperCLI;
