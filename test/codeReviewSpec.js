// Allows 'since' custom messages for unit test failures
require('jasmine-custom-message');

var path       = require('path'),
  Robot        = require('../node_modules/hubot/src/robot'),
  TextMessage  = require('../node_modules/hubot/src/message').TextMessage,
  util         = require('./lib/util');
  Users        = require('./data/users'),
  PullRequests = require('./data/prs'),
  CodeReview   = require('../src/CodeReview'),
  request      = require('supertest');
  schedule     = require('node-schedule');

/**
 * Tests the following features of code-review
    Turning the URL of a pull request on GitHub into a code review slug
    Flushing the room queues
    Adding a CR to an empty queue
    Not duplicating a CR in the same queue
    Allowing the same CR to be added in different room queues
    claiming the oldest CR in the queue ('on it')
    claiming a specific CR by slug ('on repo/123')
    tests needed claiming all PRs in the queue ('on *')
    remove/ignore newest CR in queue
    remove/ignore specific CR by slug
    list CRs by status
    mark CR as approved via GitHub webhook
    mark CR as closed via GitHub webhook
    garbage collection
 * TODO:
    GitHub filetype extra info
    ...
 */

describe("code-review.coffee", function() {
  var robot;
  var adapter;
  var code_reviews;

  /**
   * @var array List of Hubot User objects
   */
  var users = [];

  beforeEach(function(done) {

    // create new robot, without http, using the mock adapter
    robot = new Robot(null, "mock-adapter", true, "hubot");

    robot.adapter.on("connected", function() {

      // create a user
      Users().getUsers().forEach(function(user) {
        users.push(robot.brain.userForId(user.ID, {
          name: user.meta.name,
          room: user.meta.room
        }));
      });

      // load the module
      code_reviews = require("../src/code-reviews")(robot);

      adapter = robot.adapter;
      // start each test with an empty queue
      code_reviews.flush_queues();
      // wait a sec for Redis
      setTimeout(function() {
        done();
      }, 150);
    });

    robot.run();

  });

  afterEach(function() {
    users = [];
    adapter = null;
    robot.server.close();
    robot.shutdown();
  });

  it('turns a GitHub PR URL into a Code Review slug', function(done) {
    var slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec('https://github.com/alleyinteractive/wordpress-fieldmanager/pull/558'));
    expect(slug).toEqual('wordpress-fieldmanager/558');
    var slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec('https://github.com/alleyinteractive/wordpress-fieldmanager/pull/558/files'));
    expect(slug).toEqual('wordpress-fieldmanager/558');
    done();
  });

  it('flushes the queues', function(done) {
    PullRequests.forEach(function(url, i) {
      var rooms = ['alley', 'codereview', 'learnstuff', 'nycoffice'];
      addNewCR(url, {room: rooms[Math.floor(Math.random()*rooms.length)]});
    });
    expect(Object.keys(code_reviews.room_queues).length).toBeGreaterThan(0);
    // give Redis 100ms to update
    setTimeout(function() {
      expect(Object.keys(robot.brain.data.code_reviews.room_queues).length).toBeGreaterThan(0);
      code_reviews.flush_queues();
      setTimeout(function() {
        expect(Object.keys(code_reviews.room_queues).length).toBe(0);
        expect(Object.keys(robot.brain.data.code_reviews.room_queues).length).toBe(0);
        done();
      }, 100);
    }, 100);
  });

  it('adds a CR to empty queue', function(done) {
    // make sure queue is empty
    expect(Object.keys(code_reviews.room_queues).length).toEqual(0);

    var currentUser = users[6];
    var currentCR = PullRequests[4];
    var slug = code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec(currentCR));
    var re = new RegExp("^\\*" + slug + "\\* is now in the code review queue. Let me know if anyone starts reviewing this\.$");

    adapter.on('send', function(envelope, strings) {
      // there should now be one room from the current user
      var rooms = Object.keys(code_reviews.room_queues);
      expect(rooms.length).toEqual(1);
      expect(rooms[0]).toEqual(currentUser.room)

      // there should be one CR in the room queue
      expect(code_reviews.room_queues[rooms[0]].length).toEqual(1);
      expect(code_reviews.room_queues[rooms[0]][0].url).toEqual("https://github.com/alleyinteractive/ad-layers/pull/71");

      // hubot replies as expected
      expect(strings[0]).toMatch(re);
      done();
    });

    // add a PR URL to the queue
    adapter.receive(new TextMessage(currentUser, currentCR));
  });

  it('will not a allow the same CR in the same room regardless of status', function(done) {
    var currentUser = users[7];
    var url = PullRequests[4];
    code_reviews.add(new CodeReview(currentUser, makeSlug(url), url));

    // listener for second time the CR is added
    adapter.on('send', function(envelope, strings) {
      // should still be one CR in the queue
      expect(code_reviews.room_queues[currentUser.room].length).toEqual(1);

      // test different CR status next time
      if (code_reviews.room_queues[currentUser.room][0].status === 'new') {
        code_reviews.room_queues[currentUser.room][0].status = 'claimed';
      } else if (code_reviews.room_queues[currentUser.room][0].status === 'claimed') {
        code_reviews.room_queues[currentUser.room][0].status = 'approved';
      } else if (code_reviews.room_queues[currentUser.room][0].status === 'approved') {
        done();
      }
    });

    // try to add the CR again a few times
    util.sendMessageAsync(adapter, currentUser, url, 100);
    util.sendMessageAsync(adapter, currentUser, url, 200);
    util.sendMessageAsync(adapter, currentUser, url, 300);
  });

  it('will allow the same CR in a different room', function(done) {
    var currentUser = users[12];
    var url = PullRequests[6];
    var firstRoom = currentUser.room;
    code_reviews.add(new CodeReview(currentUser, makeSlug(url), url));

    // listener for second time the CR is added
    adapter.on('send', function(envelope, strings) {
      // room names should be different
      expect(firstRoom).not.toBe(envelope.room);

      var firstQueue = code_reviews.room_queues[firstRoom];
      var secondQueue = code_reviews.room_queues[envelope.room];

      // rooms should both have 1 CR
      expect(firstQueue.length).toEqual(1);
      expect(secondQueue.length).toEqual(1);
      // the CR should be the same
      expect(firstQueue[0].slug).toBe(secondQueue[0].slug);
      done();
    });

    // add the CR again in a different room
    currentUser.room = 'a_different_room';
    util.sendMessageAsync(adapter, currentUser, url, 300);
  });

  it('claims the first CR added to the queue', function(done) {
    var reviewer = users[2];
    var urlsToAdd = [PullRequests[0], PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach(function(url, i) {
      addNewCR(url, {}, 2);
    });

    var alreadyReceived = false;
    adapter.on('send', function(envelope, strings) {
      // make sure we only get one response
      expect(alreadyReceived).toBeFalsy();
      if (alreadyReceived) {
        done();
      } else {
        alreadyReceived = true;
        setTimeout(done, 100);
      }

      // should still have 4 CRs in the queue
      expect(code_reviews.room_queues[reviewer.room].length).toBe(4);

      // first one added should be claimed by reviewer
      expect(code_reviews.room_queues[reviewer.room][3].status).toBe('claimed');
      expect(code_reviews.room_queues[reviewer.room][3].reviewer).toBe(reviewer.name);

      // the rest should still be new and have no reviewer
      var unclaimedLength = code_reviews.room_queues[reviewer.room].length - 1;
      for (var i = 0; i < unclaimedLength; i++) {
        expect(code_reviews.room_queues[reviewer.room][i].status).toBe('new');
        expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBeFalsy();
      }
    });

    // wait for all the CRs to be added, then test
    util.sendMessageAsync(adapter, reviewer, 'on it', 300);
  });

  it('claims specific CR from queue', function(done) {
    var slug = 'wordpress-fieldmanager/559';
    var reviewer = users[9];
    var urlsToAdd = [PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach(function(url, i) {
      addNewCR(url, {}, 9);
    });

    adapter.on('send', function(envelope, strings) {
      for (var i = 0; i < code_reviews.room_queues[reviewer.room].length; i++) {
        // the right one should be claimed
        if (slug === code_reviews.room_queues[reviewer.room][i].slug) {
          expect(code_reviews.room_queues[reviewer.room][i].status).toBe('claimed');
          expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBe(reviewer.name);
        }
        // the rest should still be new and have no reviewer
        else {
          expect(code_reviews.room_queues[reviewer.room][i].status).toBe('new');
          expect(code_reviews.room_queues[reviewer.room][i].reviewer).toBeFalsy();
        }
      }
      done();
    });

    // claim the CR
    util.sendMessageAsync(adapter, reviewer, 'on ' + slug, 300);
  });

  it('resets a PR', function(done) {
    // add a bunch of new CRs
    PullRequests.forEach(function(url, i) {
      addNewCR(url);
    });

    // be unspecific
    util.sendMessageAsync(adapter, users[1], 'unclaim', 1, function(envelope, strings) {
      expect(strings[0]).toBe('Sorry, can you be more specific?');
    });

    // claim a CR
    util.sendMessageAsync(adapter, users[0], 'on ad-layers/71', 1, function(envelope, strings) {
      expect(code_reviews.room_queues.test_room[2].status).toBe('claimed');
      expect(code_reviews.room_queues.test_room[2].reviewer).toBe(users[0].name);
    });

    // be wrong
    util.sendMessageAsync(adapter, users[0], 'hubot: reset foo/99', 50, function(envelope, strings) {
      expect(strings[0]).toBe("Sorry, I couldn't find any PRs in this room matching `foo/99`.");
    });

    // unclaim the CR
    util.sendMessageAsync(adapter, users[0], 'hubot: unclaim ad-layers/71', 100, function(envelope, strings) {
      expect(code_reviews.room_queues.test_room[2].status).toBe('new');
      expect(code_reviews.room_queues.test_room[2].reviewer).toBe(false);
      expect(strings[0]).toBe("You got it, I've unclaimed *ad-layers/71* in the queue.");
      done();
    });

  });

  it('sets a PR for a new review without a score penalty for original reviewer', function(done) {
    // someone else adds a CR
    addNewCR(PullRequests[0], null, 1);

    // user claims the CR
    util.sendMessageAsync(adapter, users[1], 'on wp-seo/378', 1, function(envelope, strings) {
      // should be claimed by that user
      expect(code_reviews.room_queues.test_room[0].status).toBe('claimed');
      expect(code_reviews.room_queues.test_room[0].reviewer).toBe(users[1].name);

      // "redo" should reset the CR without decrementing user's score
      util.sendMessageAsync(adapter, users[1], 'hubot: redo wp-seo/378', 1, function(envelope, strings) {
        expect(code_reviews.room_queues.test_room[0].status).toBe('new');
        expect(code_reviews.room_queues.test_room[0].reviewer).toBe(false);
        expect(strings[0]).toBe("You got it, wp-seo/378 is ready for a new review.");
        done();
      });
    });
  });

  it('claims a review by searching for its slug', function(done) {
    var reviewer = users[9];
    // add a bunch of new CRs
    PullRequests.forEach(function(url, i) {
      addNewCR(url, {}, 9);
    });
    // simulate a PR that was approved and updated by webhook before being claimed from queue
    code_reviews.room_queues.test_room[0].status = 'approved';

    // 0 matches
    util.sendMessageAsync(adapter, users[7], 'on foobar', 50, function(envelope, strings) {
      expect(strings[0]).toBe("Sorry, I couldn't find any new PRs in this room matching `foobar`.");
    });

    // multiple unclaimed matches
    util.sendMessageAsync(adapter, users[7], 'on fieldmanager', 100, function(envelope, strings) {
      expect(strings[0]).toBe("You're gonna have to be more specific: `wordpress-fieldmanager/558`, or `wordpress-fieldmanager/559`?");
    });

    // 1 match, unclaimed
    util.sendMessageAsync(adapter, users[7], 'on 559', 300, function(envelope, strings) {
      expect(strings[0]).toBe('Thanks, ' + users[7].name + '! I removed *wordpress-fieldmanager/559* from the code review queue.');
    });

    // 1 match, claimed
    util.sendMessageAsync(adapter, users[8], 'on 559', 500, function(envelope, strings) {
      var bothResponses = new RegExp("Sorry, I couldn't find any new PRs in this room matching `559`."
        + "|It looks like \\*wordpress-fieldmanager\/559\\* \\(@[a-zA-Z]+\\) has already been claimed");
      expect(strings[0]).toMatch(bothResponses);
    });

    // multiple matches, only 1 is unclaimed
    util.sendMessageAsync(adapter, users[8], 'on fieldmanager', 700, function(envelope, strings) {
      expect(strings[0]).toBe('Thanks, ' + users[8].name + '! I removed *wordpress-fieldmanager/558* from the code review queue.');
    });

    // multiple matches, all claimed
    util.sendMessageAsync(adapter, users[8], 'on fieldmanager', 800, function(envelope, strings) {
      expect(strings[0]).toBe("Sorry, I couldn't find any new PRs in this room matching `fieldmanager`.");
    });

    // matches CR that was updated (e.g. by webhook) before it was claimed
    util.sendMessageAsync(adapter, users[8], 'on photon', 1000, function(envelope, strings) {
      var theCr = code_reviews.room_queues.test_room[0];
      var bothResponses = new RegExp("Sorry, I couldn't find any new PRs in this room matching `photon`."
        + "|It looks like \\*" + theCr.slug + '\\* \\(@' + theCr.user.name + '\\) has already been ' + theCr.status);
      expect(strings[0]).toMatch(bothResponses);
      done();
    });

  });

  it('claims all new CRs in the queue', function(done) {
    // add 7 PR across two rooms
    code_reviews.room_queues.test_room = [];
    code_reviews.room_queues.second_room = [];
    PullRequests.forEach(function(url, i) {
      var cr = new CodeReview(users[6], makeSlug(url), url);
      var room = i <= 3 ? 'test_room' : 'second_room';
      code_reviews.room_queues[room].unshift(cr);
    });
    expect(roomStatusCount('test_room', 'new')).toBe(4);
    expect(roomStatusCount('second_room', 'new')).toBe(3);


    var responsesReceived = 0;
    util.sendMessageAsync(adapter, users[0], 'on *', 1000, function(envelope, strings) {
      if (responsesReceived === 0) {
        expect(strings[0]).toMatch(/:tornado2?:/);
      } else {
        slug = makeSlug(PullRequests[responsesReceived - 1]);
        expect(strings[0]).toBe('Thanks, ' + users[0].name + '! I removed *' + slug + '* from the code review queue.');
      }
      responsesReceived++;

      if(responsesReceived === 5) { // 5 = :tornado2: + 4 unclaimed reviews
        // should have claimed all reviews in test_room and none of the reviews in second_room
        expect(roomStatusCount('test_room', 'claimed')).toBe(4);
        expect(roomStatusCount('test_room', 'new')).toBe(0);
        expect(roomStatusCount('second_room', 'new')).toBe(3);
        testSecondRoom();
      }
    });

    // test `on *` in a room after claiming a PR
    var testSecondRoom = function() {
      // claim the most recently added PR
      code_reviews.update_cr(code_reviews.room_queues.second_room[0], 'claimed', users[2].name);
      expect(roomStatusCount('second_room', 'claimed')).toBe(1);
      users[3].room = 'second_room';
      responsesReceived = 0;
      util.sendMessageAsync(adapter, users[3], 'on *', 1000, function(envelope, strings) {
        responsesReceived++
        if (responsesReceived === 3) { // 3 = :tornado2: + 2 unclaimed reviews
          expect(roomStatusCount('second_room', 'new')).toBe(0);
          expect(roomStatusCount('second_room', 'claimed')).toBe(3);
          done();
        }
      });
    }
  });

  it('ignores timer start command', function(done) {
    var receivedMessage = false;
    adapter.on('send', function(envelope, strings) {
      // we received a message when we shouldn't have
      receivedMessage = true;
    });
    util.sendMessageAsync(adapter, users[0], 'working on staff');

    setTimeout(function() {
      expect(receivedMessage).toBe(false);
      done();
    }, 150);
  });

  it('ignores the newest CR', function(done) {
    // add a bunch of new CRs
    PullRequests.forEach(function(url, i) {
      addNewCR(url);
    });

    // wait until all 7 are added asynchronously
    var addCrsInterval = setInterval(function() {
      if (code_reviews.room_queues.test_room.length >= PullRequests.length) {
        clearInterval(addCrsInterval);
        expect(code_reviews.room_queues.test_room[0].slug).toBe('photonfill/18');
        // ignore newest CR
        util.sendMessageAsync(adapter, users[8], 'hubot ignore', 1, function(envelope, strings) {
          expect(code_reviews.room_queues.test_room.length).toBe(PullRequests.length - 1);
          expect(code_reviews.room_queues.test_room[0].slug).toBe('wordpress-fieldmanager/558');
          done();
        });
      }
    }, 50);

  });

  it('ignores specific CR', function(done) {
    var reviewer = users[9];
    var urlsToAdd = [PullRequests[1], PullRequests[2], PullRequests[3]];
    urlsToAdd.forEach(function(url, i) {
      addNewCR(url, {}, 9);
    });

    adapter.on('send', function(envelope, strings) {
      var slug = envelope.message.text.match(/ignore (.*)/)[1];
      slugs_in_the_room = [];
      for (var i = 0; i < code_reviews.room_queues[reviewer.room].length; i++) {
        // specific slug should be ignored
        slugs_in_the_room.push(code_reviews.room_queues[reviewer.room][i].slug);
        since('Expect the ignored slug: ' + slug + ' to be gone from the room').
          expect(slug === code_reviews.room_queues[reviewer.room][i].slug).toBe(false);
      }
      // unmentioned slug should still be in the room
      since("Expected slugs that weren't ignored are still present in the room").
        expect(slugs_in_the_room.includes('searchpress/23')).toBe(true);
    });

    // ignore a couple specific crs
    util.sendMessageAsync(adapter, reviewer, 'ignore wordpress-fieldmanager/559', 100, function(envelope, strings) {
      expect(strings[0]).toBe('Sorry for eavesdropping. I removed *wordpress-fieldmanager/559* from the queue.');
    });
    util.sendMessageAsync(adapter, reviewer, 'ignore huron', 400, function(envelope, strings) {
      expect(strings[0]).toBe('Sorry for eavesdropping. I removed *huron/567* from the queue.');
      done();
    });
  });

  it('lists all CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='all';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list all crs"));
  });

  it('lists new CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='new';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list new crs"));
  });

  it('lists claimed CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='claimed';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list claimed crs"));
  });

  it('lists approved CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='approved';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list approved crs"));
  });

  it('lists closed CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='closed';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list closed crs"));
  });

  it('lists merged CRs', function(done) {
    populateTestRoomCRs();
      adapter.on("send", function(envelope, strings) {
      status='merged';
      // test message preface
      if (status === 'new') {
        expect(strings[0]).toMatch(/^There are pending code reviews\. Any takers\?/igm);
      } else {
        expect(strings[0]).toMatch(/^Here\'s a list of .* code reviews for you\./igm);
      }
      // loop through the room and make sure the list
      // that hubot sent back only contains CRs with the correct status
      code_reviews.room_queues.test_room.forEach(function(cr, i) {
        // note that the timeago string is checked in 'includes timeago information when listing crs'
        var CRFound = strings[0].indexOf('*<' + cr.url + '|' + cr.slug +'>*') >= 0;
        if(status === cr.status || status === 'all') {
          expect(CRFound).toBe(true);
        } else {
          expect(CRFound).toBe(false);
        }
      });
      done();
    });
      adapter.receive(new TextMessage(users[8], "hubot list merged crs"));
  });

  it('includes timeago information when listing crs', function(done) {
      var statuses = ['new', 'claimed', 'approved', 'closed', 'merged'];
      var halfHourInMs = 1000 * 60 * 30;
      // add CRs with different ages and statuses
      statuses.forEach(function(status, i) {
        var cr = new CodeReview(users[i], makeSlug(PullRequests[i]), PullRequests[i]);
        cr.status = status;
        cr.last_updated += -1 * i * halfHourInMs;
        code_reviews.add(cr);
      });

      adapter.on("send", function(envelope, strings) {
      var crsList = strings[0].split("\n");
      crsList.reverse(); // since we add to queue by unshift() instead of push()
      expect(crsList[0]).toMatch(/added a few seconds ago\)$/);
      expect(crsList[1]).toMatch(/claimed 30 minutes ago\)$/);
      expect(crsList[2]).toMatch(/approved an hour ago\)$/);
      expect(crsList[3]).toMatch(/closed 2 hours ago\)$/);
      expect(crsList[4]).toMatch(/merged 2 hours ago\)$/);
      expect(crsList[5]).toMatch(/Here's a list of all code reviews for you.$/);
      done();
      });
      adapter.receive(new TextMessage(users[0], "hubot list all crs"));
  });

  it('recognizes strings containing emoji', function(done) {
    //valid comments
    [
      ':horse:',
      ':+1:',
      "nice job!\n:package:\ngo ahead and deploy",
      ':pineapple::pizza:',
      'looking good :chart_with_upwards_trend:'
    ].forEach(function(string) {
      if(!code_reviews.emoji_regex.test(string)) {
        console.log(string);
      }
      expect(code_reviews.emoji_regex.test(string)).toBe(true);
    });

    [
      '😘',
      '🐩🚢',
      'nice work 🎉 code'
    ].forEach(function(string) {
      expect(code_reviews.emoji_unicode_test(string)).toBe(true);
    });

    // invalid comments
    [
      'this needs some work',
      'note: this:is not finished',
      "nice job:\nyou:"
    ].forEach(function(string) {
      expect(code_reviews.emoji_regex.test(string)).toBe(false);
      expect(code_reviews.emoji_unicode_test(string)).toBe(false);
    });

    done();
  });

  /**
   * Webhooks for approval, merging, and closing
   */

  it('does not allow invalid GitHub event webhooks', function(done) {
    testWebhook('something_else', {foo: 'bar'}, function(err, res) {
      expect(res.status).toBe(400);
      expect(res.text).toBe('invalid x-github-event something_else');
      done();
    });
  });

  it('receives GitHub webhook to approve a PR in multiple rooms', function(done) {
    var rooms = ['alley', 'codereview', 'learnstuff', 'nycoffice'];
    var approvedUrl = 'https://github.com/alleyinteractive/special/pull/456'
    var otherUrl = 'https://github.com/alleyinteractive/special/pull/123';
    // add prs to different rooms
    rooms.forEach(function(room) {
      addNewCR(approvedUrl + '/files', {room: room});
      addNewCR(otherUrl, {room: room});
    });

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      issue : {html_url : approvedUrl},
      comment : {
        body : 'I give it a :horse:, great job!',
        user : {login : 'emerckx'}
      }
    };

    // expect the approved pull request to be approved in all rooms
    // and the other pull request to be unchanged
    testWebhook('issue_comment', requestBody, function(err, res) {
      expect(res.text).toBe('issue_comment approved ' + approvedUrl);
      rooms.forEach(function(room) {
        queue = code_reviews.room_queues[room];
        expect(queue.length).toBe(2);
        expect(queue[0].url).toBe(otherUrl);
        expect(queue[0].status).toBe('new');
        expect(queue[1].url).toBe(approvedUrl + '/files');
        expect(queue[1].status).toBe('approved');
        done();
      });
    });
  });

  it('does not approve a CR when GitHub comment does not contain emoji', function(done) {
    testCommentText({
      comment: 'This needs more work, sorry.',
      expectedRes: 'issue_comment did not yet approve ',
      expectedStatus: 'new'
    }, done);
  });

  it('approves a CR when GitHub comment contains github-style emoji', function(done) {
    testCommentText({
      comment: ':pizza: :pizza: :100:',
      expectedRes: 'issue_comment approved ',
      expectedStatus: 'approved'
    }, done);
  });

  it('approves a CR when GitHub comment contains unicode emoji', function(done) {
    testCommentText({
      comment: 'nice work pal 🍾',
      expectedRes: 'issue_comment approved ',
      expectedStatus: 'approved'
    }, done);
  });

  it('DMs user when CR is approved', function(done) {
    var url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      issue : {
        html_url : url
      },
      comment : {
        body : "Nice job!:tada:\nMake these tweaks then :package: it!",
        user : {
          login : 'bridget'
        }
      }
    };

    adapter.on('send', function(envelope, strings) {
      expect(strings[0]).toBe('hey ' + envelope.room + '! bridget said :tada: :package: about ' + url);
      var cr = code_reviews.room_queues.test_room[0];
      expect(envelope.room).toBe('@' +cr.user.name);
      expect(cr.url).toBe(url);
      expect(cr.status).toBe('approved');
      done();
    });

    testWebhook('issue_comment', requestBody, function(err, res) {
      expect(res.text).toBe('issue_comment approved ' + url);
    });
  });

  it('updates an approved pull request to merged', function(done) {
    testMergeClose('merged', 'approved', 'merged', done);
  });

  it('updates an approved pull request to closed', function(done) {
    testMergeClose('closed', 'approved', 'closed', done);
  });

  it('does not update a new PR to merged', function(done) {
    adapter.on('send', function(envelope, strings) {
      expect(strings[0]).toBe("*special/456* has been merged but still needs to be reviewed, just fyi.");
      expect(envelope.room).toBe("test_room");
      done();
    });
    testMergeClose('merged', 'new', 'new');
  });

/* TEMPORARILY DISABLED Due to GitHub PullRequestReview without API
//
//   it('does not update a claimed PR to merged', function(done) {
//     adapter.on('send', function(envelope, strings) {
//       expect(strings[0]).toBe("Hey @willg, *special/456* has been merged but you should keep reviewing.");
//       expect(envelope.room).toBe("test_room");
//       done();
//     });
//     testMergeClose('merged', 'claimed', 'claimed');
//   });
*/

  it('does not update a new PR to closed', function(done) {
    adapter.on('send', function(envelope, strings) {
      expect(strings[0]).toMatch(/Hey @(\w+), looks like \*special\/456\* was closed on GitHub\. Say `ignore special\/456` to remove it from the queue\./i);
      expect(envelope.room).toBe("test_room");
      done();
    });
    testMergeClose('closed', 'new', 'new');
  });

  it('does not update a claimed PR to closed', function(done) {
    adapter.on('send', function(envelope, strings) {
      expect(strings[0]).toMatch(/Hey @willg, \*special\/456\* was closed on GitHub\. Maybe ask @(\w+) if it still needs to be reviewed\./i);
      expect(envelope.room).toBe("test_room");
      done();
    });
    testMergeClose('closed', 'claimed', 'claimed');
  });

  /**
   * Garbage Collection
   */

  it('collects the garbage', function(done) {
    // should start with job scheduled but nothing collected
    expect(code_reviews.garbage_job.pendingInvocations().length).toBe(1);
    expect(code_reviews.garbage_last_collection).toBe(0);

    // add old and new CRs
    addNewCR(PullRequests[0]);
    addNewCR(PullRequests[1]);
    addNewCR(PullRequests[2], {room: 'otherRoom'});
    addNewCR(PullRequests[3], {room: 'otherRoom'});
    code_reviews.room_queues.test_room[1].last_updated -= (code_reviews.garbage_expiration + 1000);
    code_reviews.room_queues.otherRoom[1].last_updated -= (code_reviews.garbage_expiration + 1000);

    // invoke next collection manually
    // no need to re-test that node-schedule works as expected
    code_reviews.garbage_job.invoke();

    // should have collected 1 from each room and left the right ones alone
    expect(code_reviews.garbage_last_collection).toBe(2);
    expect(code_reviews.room_queues.test_room[0].url).toBe(PullRequests[1]);
    expect(code_reviews.room_queues.otherRoom[0].url).toBe(PullRequests[3]);
    done();
  });

  /**
   * Helper functions
   */

  /**
   * test a request to CR webhook
   * @param string event 'issue_comment' or 'pull_request'
   * @param object requestBody Body of request as JSON object
   * @param function callback Takes error and result arguments
   */
  function testWebhook(eventType, requestBody, callback) {
  request(robot.router.listen())
    .post('/hubot/cr-comment')
    .set({
      'Content-Type' : 'application/json',
      'X-Github-Event' : eventType,
    })
    .send(requestBody)
    .end(function(err, res) {
      expect(err).toBeFalsy();
      callback(err, res);
    });
  }

  /**
   * Test correct handing of a comment from Github
   * @param object args
   *    string comment
   *    string expectedRes
   *    string expectedStatus
   */
  function testCommentText(args, done) {
    var url = 'https://github.com/alleyinteractive/huron/pull/567';
    addNewCR(url);

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      issue : {html_url : url},
      comment : {
        body : args.comment,
        user : {login : 'emerckx'}
      }
    };

    // not approved
    testWebhook('issue_comment', requestBody, function(err, res) {
      expect(res.text).toBe(args.expectedRes + url);
      expect(code_reviews.room_queues.test_room[0].status).toBe(args.expectedStatus);
      done();
    });
  }

  /**
   * Test selectively updating status to merged or closed
   * @param string githubStatus 'merged' or 'closed'
   * @param string localStatus Current status in code review queue
   * @param string expectedStatus Status we expect to change to (or not)
   * @param function done Optional done() function for the test
   */
  function testMergeClose(githubStatus, localStatus, expectedStatus, done) {
    var updatedUrl = 'https://github.com/alleyinteractive/special/pull/456'
    addNewCR(updatedUrl);
    code_reviews.room_queues.test_room[0].status = localStatus;
    code_reviews.room_queues.test_room[0].reviewer = 'willg';

    // setup the data we want to pretend that Github is sending
    var requestBody = {
      action : 'closed',
      pull_request : {
        merged : githubStatus === 'merged',
        html_url : updatedUrl
      }
    };

    // expect the closed pull request to be closed in all rooms
    // and the other pull request to be unchanged
    testWebhook('pull_request', requestBody, function(err, res) {
      expect(code_reviews.room_queues.test_room[0].status).toBe(expectedStatus);
      if (done) {
        done();
      }
    });
  }

  /**
   * Make a CR slug from a URL
   * @param string url
   * @return string slug
   */
  function makeSlug(url) {
    return code_reviews.matches_to_slug(code_reviews.pr_url_regex.exec(url));
  }

  /**
   * Create a new CR with a random user and add it to the queue
   * @param string url URL of GitHub PR
   * @param object userMeta Optional metadata to override GitHub User object
   * @param int randExclude Optional index in users array to exclude from submitters
   */
  function addNewCR(url, userMeta, randExclude) {
    var submitter = util.getRandom(users, randExclude).value;
    if (userMeta) {
      // shallow "extend" submitter
      Object.keys(userMeta).forEach(function(key) {
        submitter[key] = userMeta[key];
      });
    }
    code_reviews.add(new CodeReview(submitter, makeSlug(url), url));
  }

  /**
   * Get number of reviews in a room by status
   * @param string room The room to search
   * @param string status The status to search for
   * @return int|null Number of CRs matching status, or null if room not found
   */
  function roomStatusCount(room, status) {
    if (!code_reviews.room_queues[room]) {
      return null;
    }
    var counter = 0;
    code_reviews.room_queues[room].forEach(function(cr) {
      if (cr.status === status) {
        counter++;
      }
    });
    return counter;
  }

  function populateTestRoomCRs(){
    var statuses = {
      new : [],
      claimed: [],
      approved: [],
      closed: [],
      merged: []
    }
    // add a bunch of new CRs
    PullRequests.forEach(function(url, i) {
      addNewCR(url);
    });

    // make sure there's at least one CR with each status
    code_reviews.room_queues.test_room.forEach(function(review, i) {
      if (i < Object.keys(statuses).length) {
        status = Object.keys(statuses)[i];
        // update the CR's status
        code_reviews.room_queues.test_room[i].status = status;
        // add to array of expected results
        statuses[status].push(code_reviews.room_queues.test_room[i].slug);
      }
    });
  }
});
