'use strict';

var levelup = require('levelup');
var through2 = require('through2');

class Database {
  constructor(options) {
    this.connection = options.level || levelup(options.dataDirectory);
  }

  backup() {
    var output = [];
    this.connection.createReadStream()
        .pipe(through2.obj(function(data, enc, cb) {
          output.push({
            key: data.key,
            value: JSON.parse(data.value),
          });
          this.push(data);
          cb();
        }))
        .on('data', function() {
          // Need to keep the stream going.
        })
        .on('end', function() {
          console.log(JSON.stringify(output));
        });
  }
}

module.exports = Database;
