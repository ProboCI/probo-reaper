# Probo Reaper [![Build Status](https://travis-ci.com/ProboCI/probo-reaper.svg?token=pJbXLsRQ8Y3ycLpeAsZF&branch=master)](https://travis-ci.com/ProboCI/probo-reaper)

A tool for removing docker builds when the are no longer needed as
part of Probo.

The reason for removing a container is emitted as an event and also
stored. The reasons are stored as non-negative integer codes.

## Reaped Reason Codes

- 0 Unknown.
- 1 Account over disk limit.
- 2 Too many builds on the branch.
- 3 Too many builds on the PR.
- 4 The PR is closed.
- 5 The build was manually deleted.

## Node Version
Several of Probo's microservices are currently on different Node versions as we update to newer Node versions, so the Node Verson Manager, [nvm](https://github.com/nvm-sh/nvm), is installed to switch between different versions of Node prior to running `npm install`.

**Current Node Version:** Node 4.x (Current default Node version)

Run the following commands in the `probo-reaper` installation directory to update the node_modules for `probo-reaper`.

    nvm use default
    npm install
