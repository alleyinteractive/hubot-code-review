  /**
   * Helper functions
   */
var  TextMessage  = require('../../node_modules/hubot/src/message').TextMessage;

module.exports = {

  /**
   * get a random item from an array
   * @param src array Source array to get a random element from
   * @param int exclude Optional index in array to exclude
   * @return misc Array element
   */
  getRandom: (src, exclude) => {
    if (typeof exclude === 'undefined') {
      exclude = -1;
    }

    // if random index in the excluded index, adjust up or down
    var randIndex = Math.floor(Math.random() * src.length);
    if (exclude === randIndex) {
      if(randIndex === 0) {
        randIndex++;
      } else {
        randIndex--;
      }
    }
    return {
      value: src[randIndex],
      index: randIndex
    };
  },

  /**
   * use setTimeout to send a message asynchronously
   * this gives Redis time to update, etc
   * @param object adapter robot.adapter (hubot-mock-adapter)
   * @param object user Hubot user object
   * @param string text Text of message
   * @param int delay Optional delay for setTimeout, defaults to 1ms
   * @param function callback Optional callback that can contain one or more assertions.
   *                          Do not use if the same user sends the same message multiple times in one test!
   */
  sendMessageAsync: (adapter, user, text, delay, callback) => {
    if (typeof delay === 'undefined' || delay <= 0) {
      delay = 1;
    }

    var messageId = [user.room, user.name, text, delay].join('-');
    messageId = messageId.replace(/\s+/g,'');

    if (typeof callback == 'function') {
      adapter.on('send', function(envelope, strings) {
        if (envelope.message.id === messageId) {
          callback(envelope, strings);
        }
      });
    }

    setTimeout(function() {
      adapter.receive(new TextMessage(user, text, messageId));
    }, delay);
  },

  /**
   * Randomize array element order in-place.
   * Using Durstenfeld shuffle algorithm.
   * co. http://stackoverflow.com/a/12646864
   */
  shuffleArray: (array) => {
      for (var i = array.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var temp = array[i];
          array[i] = array[j];
          array[j] = temp;
      }
      return array;
  }
};