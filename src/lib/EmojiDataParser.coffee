fs = require 'fs'
path = require 'path'
punycode = require 'punycode'

class EmojiDataParser
  # construct array of Emoji character ranges from source file
  constructor: () ->
    @ranges = []
    @regex = /^(\w+)(?:\.\.)?(\w+)?/

    # make array of lines that are not comments or empty
    sourceFile = fs.readFileSync path.join(__dirname, 'emoji-data.txt'), 'utf8'
    sourceFileLines = sourceFile.split("\n").filter (line) ->
      return ! (line.length == 0 || line.charAt(0) == '#')

    # make array of min/max ranges
    # but skip low ones like
    for line in sourceFileLines
      matches = @regex.exec line
      min = if matches then parseInt(matches[1], 16) else 0
      max = if matches[2] then parseInt(matches[2], 16) else min
      if max > 1000
        @ranges.push [min, max]

  # Does string contain any emoji?
  testString: (string) ->
    # convert string to array of decimal int char codes
    # including UCS-2 surrogate pairs to Unicode single char
    chars = punycode.ucs2.decode string
    for char in chars
      if @charIsEmoji(char)
        return true
    return false

  # check if charCode falls into our emoji ranges
  # @param int charCode
  # @return bool
  charIsEmoji: (charCode) ->
    for range in @ranges
      if charCode >= range[0] and charCode <= range[1]
        return true
    return false

module.exports = EmojiDataParser