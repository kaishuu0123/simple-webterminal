// wrap a function so it only runs 100ms after the last call
// pass true to force immediate evaluation
function debounce(func) {
  var timeout;
  return function(force) {
    var obj = this;
    function delayed() {
      func.apply(obj);
      timeout = null;
    }
    if(timeout)
      clearTimeout(timeout);
    if(force)
      delayed();
    else
      timeout = setTimeout(delayed, 100);
  };
}

// clamp a value with inclusive lower and upper bounds
function clamp(i, lowerBound, upperBound) {
  if(i < lowerBound)
    return lowerBound;
  if(i > upperBound)
    return upperBound;
  return i;
}

function max(a, b) {
  return a > b ? a : b;
}

function min(a, b) {
  return a < b ? a : b;
}

function Terminal() {
  var canvas = document.getElementById("terminal");
  var ctx = canvas.getContext("2d");
  var buffer = document.createElement("canvas");
  var bufferCtx = buffer.getContext("2d");

  var charWidth = 12;
  var charHeight = 22;

  var numCols = 0;
  var numRows = 0;

  var scrollTop = 0;
  var scrollBottom = 0;

  this.setSize = function(cols, rows) {
    numCols = cols;
    numRows = rows;
    scrollTop = 0;
    scrollBottom = rows;
    canvas.width = charWidth * cols;
    canvas.height = charHeight * rows;
    buffer.width = charWidth * cols;
    buffer.height = charHeight * rows;
  }

  this.setSize(80,  24);

  var sequenceEnd = /[a-zA-Z@]/;

  /**********************************************
   * Keyboard mappings
   **********************************************/
  var mappings = {
      8: "\u0008",     // backspace
      9: "\u0009",     // tab
     27: "\u001b[~",   // escape
     33: "\u001b[5~",  // page up
     34: "\u001b[6~",  // page down
     35: "\u001b[4~",  // end
     36: "\u001b[1~",  // home
     46: "\u001b[3~",  // delete
    112: "\u001bOP",   // f1
    113: "\u001bOQ",   // f2
    114: "\u001bOR",   // f3
    115: "\u001bOS",   // f4
    116: "\u001b[15~", // f5
    117: "\u001b[17~", // f6
    118: "\u001b[18~", // f7
    119: "\u001b[19~", // f8
    120: "\u001b[20~", // f9
    121: "\u001b[21~", // f10
    122: "\u001b[23~", // f11
    123: "\u001b[24~"  // f12
  }

  function setApplicationCursorKeys(b) {
    if(b) {
      mappings[37] = "\u001bOD"; // left
      mappings[38] = "\u001bOA"; // up
      mappings[39] = "\u001bOC"; // right
      mappings[40] = "\u001bOB"; // down
    }
    else {
      mappings[37] = "\u001b[D"; // left
      mappings[38] = "\u001b[A"; // up
      mappings[39] = "\u001b[C"; // right
      mappings[40] = "\u001b[B"; // down
    }
  }

  setApplicationCursorKeys(false);

  /**********************************************
   * Colors
   **********************************************/
  // 0-15
  var colors = [
    "#000000", // regular 8 color
    "#AA0000", 
    "#00AA00", 
    "#00AA00",
    "#0000AA",
    "#AA00AA",
    "#00AAAA",
    "#FFFFFF",
    "#00AAAA",
    "#FF5555", // bright 8 color
    "#55FF55",
    "#FFFF55",
    "#5555FF",
    "#FF55FF",
    "#55FFFF",
    "#FFFFFF"
    ];

  function toHex(i) {
    var s = i.toString(16);
    while(s.length < 2) s = "0" + s;
    return s;
  }

  // 16-231
  for(var red = 0; red < 6; red++) {
    for(var green = 0; green < 6; green++) {
      for(var blue = 0; blue < 6; blue++) {
        var color = "#" +
          toHex(red ? (red * 40 + 55) : 0) +
          toHex(green ? (green * 40 + 55) : 0) +
          toHex(blue ? (blue * 40 + 55) : 0);
        colors.push(color);
      }
    }
  }

  // 232-255
  for(var gray = 0; gray < 24; gray++) {
    var b = toHex(gray * 10 + 8)
    var level = ("#" + b + b + b).toString(16);
    colors.push(level);
  }

  // reverse variants
  var reverseColors = {};
  for(i in colors) {
    var intVal = parseInt(colors[i].substr(1), 16);
    var red = intVal >> 16;
    var green = (intVal >> 8) & 0xFF;
    var blue = intVal & 0xFF;
    var color = "#" +
      toHex(255 - red) +
      toHex(255 - green) +
      toHex(255 - blue);
    reverseColors[colors[i]] = color;
  }

  /**********************************************
   * Terminal state
   **********************************************/
  var curCol = 0;
  var curRow = 0;
  var lazyScrollCount = 0;

  // Set by SM and DECSET
  var regModes = {};
  var decModes = {
    25: true // Show cursor on by default
  }

  // Set by SGR
  var displayAttribs = {
    bright: false,
    underline: false,
    blink: false,
    reverse: false,
    hidden: false,
    foregroundColor: colors[7],
    backgroundColor: colors[0]
  };

  // Used by DECSET 1049 to store original screen and cursor position
  var originalScreen = null;
  var originalCurRow = 0;
  var originalCurCol = 0;

  // Used by \e7 and \e8 to save and restore cursor position
  var savedCurRow = 0;
  var savedCurCol = 0;

  function inScrollingRegion() {
    return curRow >= scrollTop && curRow < scrollBottom;
  }

  /**********************************************
   * Rendering
   **********************************************/
  var cursorBacking;

  function translateRow(r) {
    if(r >= scrollTop && r < scrollBottom)
      r = (r - scrollTop + lazyScrollCount) % (scrollBottom - scrollTop) + scrollTop;
    return r;
  }

  var lazyScroll = debounce(function() {
    if(lazyScrollCount != 0) {
      bufferCtx.drawImage(canvas, 0, 0);
      var regionStart = scrollTop * charHeight;
      var firstChunkHeight = lazyScrollCount * charHeight;
      var secondChunkHeight = (scrollBottom - scrollTop - lazyScrollCount) * charHeight;
      ctx.drawImage(buffer,
        0, // sx
        regionStart, // sy
        canvas.width, // sw
        firstChunkHeight, // sh
        0, // dx
        regionStart + secondChunkHeight, // dy
        canvas.width, // dw
        firstChunkHeight); // dh
      ctx.drawImage(buffer,
        0, // sx
        regionStart + firstChunkHeight, // sy
        canvas.width, // sw
        secondChunkHeight, // sh
        0, // dx
        regionStart, // dy
        canvas.width, // dw
        secondChunkHeight); // dh
      lazyScrollCount = 0;
    }
  });

  function scroll() {
    while(curRow >= scrollBottom) {
      lazyScrollCount = (lazyScrollCount + 1) % (scrollBottom - scrollTop);
      var r = translateRow(scrollBottom - 1);
      ctx.fillStyle = displayAttribs.backgroundColor;
      ctx.fillRect(0, r * charHeight, canvas.width, charHeight);
      curRow--;
      lazyScroll();
    }
  }

  function scrollUp(amount) {
    if(amount <= 0)
      return;
    ctx.fillStyle = displayAttribs.backgroundColor;
    while(amount > 0) {
      lazyScrollCount = (lazyScrollCount + 1) % (scrollBottom - scrollTop);
      ctx.fillRect(0, translateRow(scrollBottom - 1) * charHeight, canvas.width, charHeight);
      amount--;
    }
    lazyScroll();
  }

  function scrollDown(amount) {
    if(amount <= 0)
      return;
    ctx.fillStyle = displayAttribs.backgroundColor;
    while(amount > 0) {
      lazyScrollCount--;
      if(lazyScrollCount < 0)
        lazyScrollCount += (scrollBottom - scrollTop);
      ctx.fillRect(0, translateRow(scrollTop) * charHeight, canvas.width, charHeight);
      amount--;
    }
    lazyScroll();
  }

  function hideCursor(text, textIndex) {
    if(!decModes[25])
      return;
    var r = translateRow(curRow);
    if(cursorBacking) {
      ctx.putImageData(cursorBacking, curCol * charWidth, r * charHeight);
      cursorBacking = null;
    }
  }

  function showCursor() {
    if(!decModes[25])
      return;
    var r = translateRow(curRow);
    if(!cursorBacking)
      cursorBacking = ctx.getImageData(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "white";
    ctx.fillRect(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.globalAlpha = 1.0;
  }

  function move(r1, c1, r2, c2, rn, cn) {
    lazyScroll(true);
    var width = (c2 - c1) * charWidth;
    var height = (r2 - r1) * charHeight;
    ctx.drawImage(canvas, c1 * charWidth, r1 * charHeight, width, height, cn * charWidth, rn * charHeight, width, height);
  }

  function clear(r1, c1, r2, c2) {
    lazyScroll(true);
    ctx.fillStyle = displayAttribs.backgroundColor;
    ctx.fillRect(c1 * charWidth, r1 * charHeight, (c2 - c1) * charWidth, (r2 - r1) * charHeight);
  }

  function render(ch) {
    var r = translateRow(curRow);
    var bg = displayAttribs.backgroundColor;
    var fg = displayAttribs.foregroundColor;
    if(displayAttribs.reverse) {
      bg = reverseColors[bg];
      fg = reverseColors[fg];
    }
    ctx.fillStyle = bg;
    ctx.fillRect(curCol * charWidth, r * charHeight, charWidth, charHeight);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.fillText(ch, curCol * charWidth + 3, (r + 1) * charHeight - 4);
  }

  /**********************************************
   * Escape sequences
   **********************************************/
  function getInt(args, i) {
    if(args && args.length != 0) {
      i = parseInt(args);
      if(isNaN(i)) throw "Invalid integer format";
      if(i < 0) throw "Negative integer";
    }
    return i;
  }

  function csi(command) {
    var type = command[command.length - 1];
    var args = command.substr(0, command.length - 1);
//    if(type != "m" && type != "H" && type != "A" && type != "B" && type != "C" && type != "D" && type != "h" && type != "l")a
//    if(type != "m")
//      console.log(command);
    if(type == "@") { // ICH -- Insert Character
      if(!inScrollingRegion()) return;
      var amount = min(getInt(args, 1), numCols - curCol);
      move(curRow, curCol, curRow + 1, numCols, curRow, curCol + amount);
      clear(curRow, curCol, curRow + 1, curCol + amount);
    }
    else if(type == "m") { // SGR -- Select Graphic Rendition
      var attribs = [0];
      if(args.length != 0) {
        attribs = args.split(';');
        for(attribNum in attribs) {
          attribs[attribNum] = parseInt(attribs[attribNum]);
          if(isNaN(attribs[attribNum])) return;
        }
      }
      for(var attribNum = 0; attribNum < attribs.length; attribNum++) {
        switch(attribs[attribNum]) {
          case 0:
            displayAttribs.bright = false;
            displayAttribs.underline = false;
            displayAttribs.blink = false;
            displayAttribs.reverse = false;
            displayAttribs.hidden = false;
            displayAttribs.foregroundColor = colors[7]
            displayAttribs.backgroundColor = colors[0];
            break;
          case 1:
            displayAttribs.bright = true;
            break;
          case 4:
            displayAttribs.underline = true;
            break;
          case 5:
            displayAttribs.blink = true;
            break;
          case 7:
            displayAttribs.reverse = true;
            break;
          case 8:
            displayAttribs.hidden = true;
            break;
          case 22:
            displayAttribs.bright = false;
            break;
          case 24:
            displayAttribs.underscore = false;
            break;
          case 25:
            displayAttribs.blink = false;
            break;
          case 27:
            displayAttribs.reverse = false;
            break;
          case 28:
            displayAttribs.hidden = false;
            break;
          case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
            var colorNum = attribs[attribNum] - 30;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 38:
            var five = attribs[++attribNum];
            if(five != 5) {
              console.log("five is " + five);
              return;
            }
            var colorNum = attribs[++attribNum];
            if(colorNum < 0 || colorNum > 255) {
              console.log("bad foreground color " + colorNum);
              return;
            }
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 39:
            displayAttribs.foregroundColor = colors[7];
            break;
          case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
            var colorNum = attribs[attribNum] - 40;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          case 48:
            var five = attribs[++attribNum];
            if(five != 5) {
              console.log("five is " + five);
              return;
            }
            var colorNum = attribs[++attribNum];
            if(colorNum < 0 || colorNum > 255) {
              console.log("bad background color " + colorNum);
              return;
            }
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          case 49:
            displayAttribs.backgroundColor = colors[0];
            break;
          case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
            var colorNum = attribs[attribNum] - 90;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.foregroundColor = colors[colorNum];
            break;
          case 100: case 101: case 42: case 103: case 104: case 105: case 106: case 107:
            var colorNum = attribs[attribNum] - 40;
            if(displayAttribs.bright) colorNum += 8;
            displayAttribs.backgroundColor = colors[colorNum];
            break;
          default:
            console.log("Unhandled display attribute " + attribs[attribNum]);
            break;
        }
      }
    }
    else if(type == "K") {
      if(args[0] == "?") { // DECSEL
        console.log("Unhandled DECSEL");
      }
      else { // EL -- Erase in Line
        var mode = getInt(args, 0);
        if(mode == 0)  // clear right
          clear(curRow, curCol, curRow + 1, numCols);
        else if(mode == 1)  // clear left
          clear(curRow, 0, curRow + 1, curCol + 1);
        else if(mode == 2) // clear whole line
          clear(curRow, curCol, curRow + 1, numCols);
      }
    }
    else if(type == "P") { // DCH -- Delete Character
      var amount = min(getInt(args, 1), numCols - curCol);
      move(curRow, curCol + amount, curRow + 1, numCols, curRow, curCol);
      clear(curRow, numCols - amount, curRow + 1, numCols);
    }
    else if(type == "A") { // CUU -- CUrsor Up
      curRow = max(curRow - getInt(args, 1), 0);
    }
    else if(type == "B") { // CUD -- CUrsor Down
      curRow = min(curRow + getInt(args, 1), numRows - 1);
    }
    else if(type == "C") { // CUF -- CUrsor Forward
      curCol = min(curCol + getInt(args, 1), numCols - 1);
    }
    else if(type == "D") { // CUB -- CUrsor Back
      curCol = max(curCol - getInt(args, 1), 0);
    }
    else if(type == "E") { // CNL -- Cursor Next Line
      curRow = min(curRow + getInt(args, 1), numRows - 1);
      curCol = 0;
    }
    else if(type == "F") { // CPL -- Cursor Previous Line
      curRow = max(curRow - getInt(args, 1), 0);
      curCol = 0;
    }
    else if(type == "G") { // CHA -- Cursor Horizontal Absolute
      curCol = clamp(getInt(args, 1), 1, numCols) - 1;
    }
    else if(type == "H") { // CUP -- Cursor Position
      var coords = args.split(";");
      curRow = clamp(getInt(coords[0], 1), 1, numRows) - 1;
      curCol = clamp(getInt(coords[1], 1), 1, numCols) - 1;
    }
    else if(type == "J") { // ED -- Erase in Display
      var mode = getInt(args, 0);
      if(mode == 0) { // below
        clear(curRow, curCol, curRow + 1, numCols); // current line
        if(curRow + 1 < numRows)
          clear(curRow + 1, 0, numRows, numCols); // everything below
      }
      else if(mode == 1) { // above
        clear(curRow, 0, curRow + 1, numCols); // current line
        if(curRow > 0)
          clear(0, 0, curRow, numCols); // everything above
      }
      else if(mode == 2) { // all
        clear(0, 0, numRows, numCols);
      }
      else {
        console.log("Unknown ED mode " +mode);
      }
    }
    else if(type == "L") { // IL -- Insert Line
      // TODO LOOK AT ME
      var amount = getInt(args, 1);
      move(curRow, 0, scrollBottom - amount, numCols, curRow + amount, 0);
      clear(curRow, 0, curRow + amount, numCols);
    }
    else if(type == "M") { // DL -- Delete Line
      // TODO LOOK AT ME
      var amount = getInt(args, 1);
      move(curRow + amount, 0, scrollBottom, numCols, curRow, 0);
      clear(scrollBottom - amount, 0, scrollBottom, numCols);
    }
    else if(type == "S") { // SU -- Scroll Up
      scrollUp(getInt(args, 1));
    }
    else if(type == "T") { // SD -- Scroll Down
      scrollDown(getInt(args, 1));
    }
    else if(type == "c") { // DA -- Device attributes
      if(args[0] == ">") {
        // Used by PuTTy. Latest xterm is 271. It causes vim to send funky stuff
        // I don't feel like dealing with right now.
        socket.send("\u001b[>0;136;0c");
      }
      else {
        console.log("Primary device attributes not supported");
      }
    }
    else if(type == "d") { // VPA -- Vertical Position Absolute
      curRow = clamp(getInt(args, 1), 1, numRows) - 1;
    }
    else if(type == "h") {
      if(args[0] == "?") { // DECSET
        //    1 application cursor keys
        //   12 blinking cursor
        //   25 show cursor
        // 1034 set 8 bit input
        // 1049 alternate screen buffer
        args = args.substr(1).split(";");
        for(argNum in args) {
          var mode = parseInt(args[argNum]);
          if(isNaN(mode)) return;
          decModes[mode] = true;
          if(mode == 1) {
            setApplicationCursorKeys(true);
          }
          else if(mode == 1049) {
            originalScreen = ctx.getImageData(0, 0, canvas.width, canvas.height);
            originalCurRow = curRow;
            originalCurCol = curCol;
          }
          //console.log("Set dec mode " + mode);
        }
      }
      else { // SM
        args = args.split(";");
        for(argNum in args) {
          var mode = parseInt(args[argNum]);
          if(isNaN(mode)) return;
          regModes[mode] = true;
          //console.log("Set reg mode " + mode);
        }
      }
    }
    else if(type == "l") {
      if(args[0] == "?") { // DECRST
        args = args.substr(1).split(";");
        for(argNum in args) {
          var mode = parseInt(args[argNum]);
          if(isNaN(mode)) return;
          delete decModes[mode];
          if(mode == 1) {
            setApplicationCursorKeys(false);
          }
          else if(mode == 1049) {
            if(originalScreen)
              ctx.putImageData(originalScreen, 0, 0);
            curRow = originalCurRow;
            curCol = originalCurCol;
            originalScreen = null;
          }
          //console.log("Reset dec mode " + mode);
        }
      }
      else { // RM
        args.args.split(";");
        for(argNum in args) {
          var mode = parseInt(arg[argNum]);
          if(isNaN(mode)) return;
          delete regModes[mode];
          //console.log("Reset reg mode " + mode);
        }
      }
    }
    else if(type == "r") { // DECSTBM
      lazyScroll(true); // Important!
      curRow = 0;
      curCol = 0;
      var bounds = args.split(";");
      scrollTop = clamp(getInt(bounds[0], 1), 1, numRows) - 1;
      scrollBottom = clamp(getInt(bounds[1], numRows), 1, numRows);
      if(scrollTop > scrollBottom)
        throw "Bad scrolling region set";
    }
    else {
      console.log("Unhandled CSI escape sequence: " + command);
    }
  }

  function osc(command) {
    var args = command.split(";", 2);
    if(args[0] == "0") {
      if(args.length == 2)
        document.title = args[1];
    }
    else if(args[0] == "2") {
      if(args.length == 2)
        document.title = args[1];
    }
    else {
      console.log("unhandled osc: " + args[0]);
    }
  }

  function escape_(text, textIndex) {

    //console.log(text);

    if(text[textIndex] == "=") {
      //console.log("Application keypad");
      return textIndex + 1;
    }

    if(text[textIndex] == ">") {
      //console.log("Normal keypad");
      return textIndex + 1;
    }

    if(text[textIndex] == "M") {
      console.log("Reverse Index");
      return textIndex + 1;
    }

    if(text[textIndex] == "(") {
      // Change character set -- we don't really care.
      return textIndex + 2;
    }

    if(text[textIndex] == "7") {
      savedCurRow = curRow;
      savedCurCol = curCol;
      return textIndex + 1;
    }

    if(text[textIndex] == "8") {
      curRow = savedCurRow;
      curCol = savedCurCol;
      return textIndex + 1;
    }

    if(text[textIndex] == "]") {
      textIndex++;
      var commandLen = text.indexOf("\u0007", textIndex) - textIndex;
      if(commandLen < 0) {
        console.log("osc sequence unterminated");
        return textIndex;
      }
      osc(text.substr(textIndex, commandLen));
      return textIndex + commandLen;
    }

    if(text[textIndex] == "[") {
      textIndex++;
      var commandLen = text.substr(textIndex).search(sequenceEnd);
      if(commandLen < 0) {
        console.log("csi sequence unterminated");
        return textIndex;
      }
      commandLen++;
      csi(text.substr(textIndex, commandLen));
      return textIndex + commandLen;
    }

    console.log("Unhandled escape sequence: " + text.substr(textIndex));
    return textIndex;
  }

  this.write = function(text) {
    hideCursor();
    ctx.font = "14px Unknown Font, sans-serif";

    var i = 0;
    while(i < text.length) {
      var ch = text[i++];
      if(ch == "\u001B") { // escape
        i = escape_(text, i);
      }
      else if(ch == "\r") { // carriage return
        curCol = 0;
      }
      else if(ch == "\n") { // newline
        curRow++;
        scroll();
      }
      else if(ch == "\u0007") { // bell
        // Change window title?
      }
      else if(ch == "\u0008") { // backspace
        if(curCol > 0)
          curCol--;
      }
      else if(ch == "\u0009") { // tab
        curCol = min(curCol + (8 - curCol % 8), numCols - 1);
      }
      else {
        var code = ch.charCodeAt(0);
        //console.log("char [" + ch + "] code [" + code + "]");
        if(code < 32 || code > 126) {
          console.log("Unknown character code: " + code);
        }
        else {
          if(curCol == numCols) {
            curCol = 0;
            curRow++;
            scroll();
          }

          render(ch);

          curCol++;
        }
      }
    }
    showCursor();
  } // write()

  function sendMouseEvent(b, e) {
    if(e.shiftKey)
      b += 4;
    if(e.altKey)
      b += 8;
    if(e.ctrlKey)
      b += 16;
    var r = 32 + Math.floor(e.offsetY / charHeight) + 1;
    var c = 32 + Math.floor(e.offsetX / charWidth) + 1;
    socket.send("\u001b[M" + String.fromCharCode(b) + String.fromCharCode(c) + String.fromCharCode(r));
  }

  function sendMouseButtonEvent(e) {
    // TODO support motion tracking
    if(!decModes[1000] && !decModes[1002])
      return false;
    var b = 32;
    if(e.button == 0)
      b += 0;
    else if(e.button == 1)
      b += 1;
    else if(e.button == 2)
      b += 2;
    if(e.type == "mouseup")
      b += 3;
    sendMouseEvent(b, e);
    return true;
  }

  function sendMouseWheelEvent(e) {
    if(!decModes[1000] && !decModes[1002])
      return false;
    var b = 32 + 64;
    if(e.wheelDelta > 0)
      b += 0;
    else if(e.wheelDelta < 0)
      b += 1;
    sendMouseEvent(b, e);
    return true;
  }

  this.onKeyDown = function(e) {
    var trans = mappings[e.keyCode];
    if(trans) {
      socket.send(trans);
      return false;
    }
    if(e.ctrlKey && e.keyCode >= 65 && e.keyCode <= 90) { // ctrl-alpha
      socket.send(String.fromCharCode(e.keyCode - 64));
      return false;
    }
    if(e.altKey && e.keyCode >= 65 && e.keyCode <= 90) { // alt-alpha
      socket.send("\u001b" + String.fromCharCode(e.keyCode));
      return false;
    }
    if(e.ctrlKey && e.keyCode == 32) { // alt-space
      socket.send("\u001b@");
      return false;
    }
    return true;
  };

  canvas.onmousedown = function(e) { return sendMouseButtonEvent(e); }
  canvas.onmouseup = function(e) { return sendMouseButtonEvent(e); }
  canvas.onmousewheel = function(e) { return sendMouseWheelEvent(e); }
}

var term = new Terminal();

var socket = new WebSocket("ws://localhost:3000/terminal");
socket.onopen = function() {
  term.write("\u001B[2J"); // ED 2 (clear everything)
};

socket.onmessage = function(e) {
  term.write(e.data);
};

document.onkeypress = function(e) {
  socket.send(String.fromCharCode(e.keyCode));
  return true;
}

// We need to catch some keys onkeydown so the browser doesn't handle them

document.onkeydown = function(e) { return term.onKeyDown(e); };
