	/**
	Tetris
	========================

	@file      : Tetris.js
	@version   : 1.0.0
	@author    : Ivo Sturm
	@date      : 12-8-2018
	@copyright : First Consulting
	@license   : Apache V2

	Documentation
	=============
	
	Add a tetris game to your application. 
	
	v1.0	Multiple styling options, like coloring per block, opacity over all blocks. 
			Adjust start speed, maximum speed and speed increment per row removed. 
			For analysis purposes a game log per row removed is kept track of.
	
*/

// Required module list. Remove unnecessary modules, you can always get them back from the boilerplate.
define([
    "dojo/_base/declare",
    "mxui/widget/_WidgetBase",
	"dijit/_TemplatedMixin",
	"dojo/_base/fx",
	"dojo/fx/easing",
	"dojo/NodeList-traverse",	
	"mxui/dom",
	"dojo/dom-style",
	"dijit/registry",
	"dojo/dom-geometry",
	"dojo/window",
	"dojo/text!Tetris/widget/template/Tetris.html"
	,"Tetris/lib/stats"
], function(declare, _WidgetBase, _TemplatedMixin, baseFx, easing, NodeList,  dom, domStyle, registry, domGeom, win, widgetTemplate,stats) {
    "use strict";

    // Declare widget's prototype.
    return declare("Tetris.widget.Tetris", [ _WidgetBase, _TemplatedMixin ], {
		
		//TemplatedMixin will create our dom node using this HTML template
		templateString: widgetTemplate,
		_logNode : 'Tetris widget: ',
		_invalid : {},
		_pieces : [],

		//-------------------------------------------------------------------------
		// game constants
		//-------------------------------------------------------------------------
		KEY     : { ESC: 27, SPACE: 32, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40 },
        DIR     : { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3, MIN: 0, MAX: 3 },
        //stats   : new Stats(),
        nx      : 10, // width of tetris court (in blocks)
        ny      : 20, // height of tetris court (in blocks)
        nu      : 5, // width/height of upcoming preview (in blocks)
		//-------------------------------------------------------------------------
		// tetris pieces
		//
		// blocks: each element represents a rotation of the piece (0, 90, 180, 270)
		//         each element is a 16 bit integer where the 16 bits represent
		//         a 4x4 set of blocks, e.g. j.blocks[0] = 0x44C0
		//
		//             0100 = 0x4 << 3 = 0x4000
		//             0100 = 0x4 << 2 = 0x0400
		//             1100 = 0xC << 1 = 0x00C0
		//             0000 = 0x0 << 0 = 0x0000
		//                               ------
		//                               0x44C0
		//
		//-------------------------------------------------------------------------
		i : { size: 4, blocks: [0x0F00, 0x2222, 0x00F0, 0x4444], color: 'cyan'   },
		j : { size: 3, blocks: [0x44C0, 0x8E00, 0x6440, 0x0E20], color: 'blue'   },
		l : { size: 3, blocks: [0x4460, 0x0E80, 0xC440, 0x2E00], color: 'orange' },
		o : { size: 2, blocks: [0xCC00, 0xCC00, 0xCC00, 0xCC00], color: 'yellow' },
		s : { size: 3, blocks: [0x06C0, 0x8C40, 0x6C00, 0x4620], color: 'green'  },
		t : { size: 3, blocks: [0x0E40, 0x4C40, 0x4E00, 0x4640], color: 'purple' },
		z : { size: 3, blocks: [0x0C60, 0x4C80, 0xC600, 0x2640], color: 'red'    },
		//-------------------------------------------------------------------------
		// game variables (initialized during reset)
		//-------------------------------------------------------------------------
		dx : null,
		dy : null,        // pixel size of a single tetris block
        blocks : [],        // 2 dimensional array (nx*ny) representing tetris court - either empty block or occupied by a 'piece'
        actions : [],       // queue of user actions (inputs)
        playing : false,       // true|false - game is in progress
		paused : false,       // true|false - game is paused
        dt : 0,            // time since starting this game
        current : null,       // the current piece
        next : null,          // the next piece
        score : 0,         // the current score
        vscore : 0,        // the currently displayed score (it catches up to score in small chunks - like a spinning slot machine)
        rows : 0,          // number of completed rows in the current game
		level : 0,		 // level of the game
		speedLevel : 1,		// speed of the game
        step : 0,        // how long before current piece drops by 1 row
		oldLevel : 0,	// keep track of the old level, so we now when the level is upgraded and trigger upgrading speed
		gameLog : '', // keep track of the full game of a player.
		
		postCreate : function(){
			// how long before piece drops by 1 row (seconds)
			this.speed   = { 
				start : this.speedStart / 1000, 
				decrement : this.speedIncrement / 1000, 
				min : this.speedMax / 1000
			}; 
			this.initialStep = this.speed.start;  // to being able to keep track of speed increase in speed div
			
			if (this.readOnly || this.get("disabled") || this.readonly) {
              this._readOnly = true;
            }
			this.nameLabel.innerHTML = this.labelName;
			this.nameInput.placeholder = this.placeholderName;
			this.nameInput.style.width = '50%';
			this.nameInput.style.marginLeft = '25%';

			this.ctx     = this.canvasDiv.getContext('2d');
			this.uctx     = this.upcomingDiv.getContext('2d');
						
			/*if (window.requestAnimationFrame) { // http://paulirish.com/2011/requestanimationframe-for-smart-animating/*/
			// overwrite the standard fps rate which is normally 60 fps for monitors.
			window.requestAnimationFrame = /*window.webkitRequestAnimationFrame ||
											 window.mozRequestAnimationFrame    ||
											 window.oRequestAnimationFrame      ||
											 window.msRequestAnimationFrame     ||*/
											 dojo.hitch(this,function(callback, element) {
											  
												   window.setTimeout(callback, 1000 / this.FPS);
											 											  
			
			});
			this.nx = this.courtWidth;
			this.ny = this.courtHeight;
			// adjust width/height of upcoming preview (in blocks)
			this.nu = (this.courtWidth / 10) * this.nu;
			// overrule default styling of blocks
			this._setCustomStyling();
			this._setupEvents();

			// RUN the game
			this._run();		
		},
        // Attach events to HTML dom elements
		_setupEvents: function () {
			var object;
			// check whether input is emptied after change
			this.connect(this.nameInput, "onchange", dojo.hitch(this, function (evt) {

				object = evt.target;
				var changedValue = object.value;
				
				if (changedValue == ''){
					this.contextObj.set(this.nameAttr,'');
				} else {
					this.contextObj.set(this.nameAttr,changedValue);
				}
            }));
		
        },
		_setCustomStyling : function(){
			this.i.color = this.colorI;
			this.j.color = this.colorJ;
			this.l.color = this.colorL;
			this.o.color = this.colorO;
			this.s.color = this.colorS;
			this.t.color = this.colorT;
			this.z.color = this.colorZ;
			this.upcomingDiv.style.backgroundColor = this.upcomingDivColor;
			this.upcomingDiv.style.border = '2px solid black';
			this.canvasDiv.style.border = '2px solid black';
			this.canvasDiv.style.backgroundColor = this.canvasDivColor;
		},
		update : function(obj, callback){
			this.contextObj = obj;		
			if (typeof(callback) == "function") {
				callback();
			} 
		},
        // Rerender the interface.
        _updateRendering: function () {
			

		},
		//-------------------------------------------------------------------------
		// base helper methods
		//-------------------------------------------------------------------------
		get : function(id){ return document.getElementById(id);  },
		hide : function(id){ this.get(id).style.visibility = 'hidden'; },
		show : function(id){ this.get(id).style.visibility = null;     },
		html : function(id,html){ this.get(id).innerHTML = html;            },
		timestamp : function(){ return new Date().getTime();                             },
		random : function(min, max) { return (min + (Math.random() * (max - min)));            },
		randomChoice : function(choices) { return choices[Math.round(this.random(0, choices.length-1))]; },		
			
		//------------------------------------------------
		// do the bit manipulation and iterate through each
		// occupied block (x,y) for a given piece
		//------------------------------------------------
		eachblock : function(type, x, y, dir, fn) {
		  var bit, row = 0, col = 0, blocks = type.blocks[dir];
		  for(bit = 0x8000 ; bit > 0 ; bit = bit >> 1) {
			if (blocks & bit) {
			  fn(x + col, y + row);
			}
			if (++col === 4) {
			  col = 0;
			  ++row;
			}
		  }
		},
		//-----------------------------------------------------
		// check if a piece can fit into a position in the grid
		//-----------------------------------------------------
		occupied : function (type, x, y, dir) {
		  var result = false;
		  this.eachblock(type, x, y, dir, dojo.hitch(this,function(x, y) {
			if ((x < 0) || (x >= this.nx) || (y < 0) || (y >= this.ny) || this.getBlock(x,y))
			  result = true;
		  }));
		  return result;
		},
		unoccupied : function (type, x, y, dir) {
		  return !this.occupied(type, x, y, dir);
		},
		//-----------------------------------------
		// start with 4 instances of each piece and
		// pick randomly until the 'bag is empty'
		//----------------------------------------- 
		randomPiece : function () {
		  var piece;
		  if (this._pieces.length == 0)
			this._pieces = [this.i,this.i,this.i,this.i,this.j,this.j,this.j,this.j,this.l,this.l,this.l,this.l,this.o,this.o,this.o,this.o,this.s,this.s,this.s,this.s,this.t,this.t,this.t,this.t,this.z,this.z,this.z,this.z];
		  var type = this._pieces.splice(this.random(0, this._pieces.length-1), 1)[0];
		  piece = { type: type, dir: this.DIR.UP, x: Math.round(this.random(0, this.nx - type.size)), y: 0 };
		  return piece;
		},
		//-------------------------------------------------------------------------
		// GAME LOOP
		//-------------------------------------------------------------------------
		_run : function() {
		  this.showStats(); // initialize FPS counter
		  this.addEvents(); // attach keydown and resize events
		  var last, now = this.timestamp();
		  this.resize(); // setup all our sizing information
		  this.reset();  // reset the per-game variables
		  this.frame(last,now);  // start the first frame
		},
		frame : function(last,now) {
			now = this.timestamp();
			this.updateTetris(Math.min(1, (now - last) / 1000.0)); // using requestAnimationFrame have to be able to handle large delta's caused when it 'hibernates' in a background or non-visible tab
			this.draw();
			//this.stats.update();
			last = now;
			window.requestAnimationFrame(
				dojo.hitch(this,function(){
					this.frame(last,now);
				}), 
				this.canvasDiv
			);						
		  }	,	
		showStats : function () {
		 // this.stats.domElement.id = 'stats';
		  //this.get('menu').appendChild(this.stats.domElement);
		},
		addEvents : function () {
		  document.addEventListener('keydown', dojo.hitch(this,function(ev){this.keydown(ev);}), false);
		  window.addEventListener('resize', dojo.hitch(this,function(ev){this.resize(ev);}), false);
		},
		resize : function (event) {
			this.canvasDiv.width   = this.canvasDiv.clientWidth;  // set canvas logical size equal to its physical size
			this.canvasDiv.height  = this.canvasDiv.clientHeight; // (ditto)
		  
		  this.upcomingDiv.width  = this.upcomingDiv.clientWidth;//this.ratioX * this.upcomingDiv.width;
		  this.upcomingDiv.height  = this.upcomingDiv.clientHeight;
		  this.dx = this.canvasDiv.width  / this.nx; // pixel size of a single tetris block
		  this.dy = this.canvasDiv.height / this.ny; // (ditto)
		  this.invalidate();
		  this.invalidateNext();
		},
		keydown : function (ev) {
		  var handled = false;
		  if (this.playing) {
			switch(ev.keyCode) {
			  case this.KEY.LEFT:   this.actions.push(this.DIR.LEFT);  handled = true; break;
			  case this.KEY.RIGHT:  this.actions.push(this.DIR.RIGHT); handled = true; break;
			  case this.KEY.UP:     this.actions.push(this.DIR.UP);    handled = true; break;
			  case this.KEY.DOWN:   this.actions.push(this.DIR.DOWN);  handled = true; break;
			  case this.KEY.ESC:    this.lose();                  handled = true; break;
			  case this.KEY.SPACE:    this.pause();                  handled = true; break;
			}
		  }
		  else if (ev.keyCode == this.KEY.SPACE && this.paused == false) {
			this.play();
			handled = true;
		  } else if (ev.keyCode == this.KEY.SPACE && this.paused) {
			this.pause();
			handled = true;
		  }
		  if (handled)
			ev.preventDefault(); // prevent arrow keys from scrolling the page (supported in IE9+ and all other browsers)
		},
		//-------------------------------------------------------------------------
		// GAME LOGIC
		//-------------------------------------------------------------------------
		play : function (){ 
			
			// check if name is filled. Can't start without a player's name
			var validated = this.validateName(); 
			if (validated){
				this.hide('start');
				this.nameInput.readOnly = true;
			//this.nameInput.getEnclosingWidget.set('readOnly', true);
				this.addGameLog('Started the game!','warn');
				this.reset(); 
				this.playing = true;  
			}
		},
		lose : function () { 
			this.show('start'); 
			this.html('start','<b>' + this.newGameMessage + '</b>');
			this.setVisualScore(); 
			this.playing = false; 
			mx.ui.info('Game Over! ' + this.newGameMessage, true);
			
		},
		pause : function () { 

			if (this.paused == false){			
				this.addGameLog('Paused the game!','warn');			
				this.html('start','<b>Game Paused</b>'); 
				this.show('start'); 
				this.setVisualScore(); 
				this.playing = false; 
				this.paused = true;
			} else {
				this.addGameLog('Unpaused the game!','warn');
				this.hide('start'); 
				this.playing = true;
				this.paused = false;
			}

		},
		setVisualScore : function (n)      { this.vscore = n || this.score; this.invalidateScore(); },
		setScore : function (n)            { this.score = n; this.setVisualScore(n);  },
		addScore : function (n)            { this.score = this.score + n;   },
		clearScore : function ()           { this.setScore(0); },
		clearRows : function ()            { this.setRows(0); },
		setRows : function (n)             { 
			var lastRows = this.rows;
			this.rows = n; 
			// every 10 rows made, upgrade the level + speed
			this.level = Math.floor(n / 10); 

			// every row made, upgrade the speed with the decrement, every new level reached upgrade it even more
			this.step = Math.max(this.speed.min, this.speed.start - (this.speed.decrement*(this.rows /*+ this.level * 5*/)) );
			
			if (this.rows > 0){
				var message =  'Rows removed/total: ' + (n - lastRows) + ' / ' + this.rows + ', level: ' + this.level + ', speed: '  + this.step + ', score: ' + this.score;
				this.addGameLog(message,'log');
			}
			
			// every level upgrade trigger a bigger change in speed
			if (this.level > this.oldLevel){
				this.invalidateLevel();
			}	
			this.invalidateRows(); 
			
		},
		addRows : function (n)             { this.setRows(this.rows + n); },
		getBlock : function (x,y)          { return (this.blocks && this.blocks[x] ? this.blocks[x][y] : null); },
		setBlock : function (x,y,type)     { this.blocks[x] = this.blocks[x] || []; this.blocks[x][y] = type; this.invalidate(); },
		clearBlocks : function ()          { this.blocks = []; this.invalidate(); },
		clearActions : function ()        { this.actions = []; },
		setCurrentPiece : function (piece) {  this.current = piece || this.randomPiece(); this.invalidate();     },
		setNextPiece : function (piece)    { this.next    = piece || this.randomPiece(); this.invalidateNext(); },
		reset : function () {
		  this.dt = 0;
		  this.clearActions();
		  this.clearBlocks();
		  this.clearRows();
		  this.clearScore();
		  this.setCurrentPiece(this.next);
		  this.setNextPiece();
		},
		updateTetris : function (idt) {
		  if (this.playing) {
			//console.log('playing..');  
			if (this.vscore < this.score)
			  this.setVisualScore(this.vscore + 1);
			this.handle(this.actions.shift());
			
			this.dt = this.dt + idt;
			if (this.dt > this.step) {
			  this.dt = this.dt - this.step;
			  this.drop();
			}
		  }
		},
		handle : function (action) {
		  switch(action) {
			case this.DIR.LEFT:  this.move(this.DIR.LEFT);  break;
			case this.DIR.RIGHT: this.move(this.DIR.RIGHT); break;
			case this.DIR.UP:    this.rotate();        break;
			case this.DIR.DOWN:  this.drop();          break;
		  }
		},
		move : function (dir) {
		  var x = this.current.x, y = this.current.y;
		  switch(dir) {
			case this.DIR.RIGHT: x = x + 1; break;
			case this.DIR.LEFT:  x = x - 1; break;
			case this.DIR.DOWN:  y = y + 1; break;
		  }
		  if (this.unoccupied(this.current.type, x, y, this.current.dir)) {
			this.current.x = x;
			this.current.y = y;
			this.invalidate();
			return true;
		  }
		  else {
			return false;
		  }
		},
		rotate : function () {
		  var newdir = (this.current.dir == this.DIR.MAX ? this.DIR.MIN : this.current.dir + 1);
		  if (this.unoccupied(this.current.type, this.current.x, this.current.y, newdir)) {
			this.current.dir = newdir;
			this.invalidate();
		  }
		},
		drop : function () {
		  if (!this.move(this.DIR.DOWN)) {
			this.addScore(10);
			this.dropPiece();
			this.removeLines();
			this.setCurrentPiece(this.next);
			this.setNextPiece(this.randomPiece());
			this.clearActions();
			if (this.occupied(this.current.type, this.current.x, this.current.y, this.current.dir)) {
				// write game over message to game log
			  this.addGameLog('Game Over!','warn');
				// update Mendix object with actual values
			  this.contextObj.set(this.scoreAttr,this.score);
			  this.contextObj.set(this.rowsAttr,this.rows);
			  this.contextObj.set(this.levelAttr,this.level);
			  this.contextObj.set(this.nameAttr, this.nameInput.value);
			  this.contextObj.set(this.gameLogAttr,this.gameLog);

			  // trigger save MF
			  this._execMf(this.saveMF,this.contextObj.getGuid());
			  
			  this.lose();
			}
		  }
		},
		dropPiece : function () {
		  this.eachblock(this.current.type, this.current.x, this.current.y, this.current.dir, dojo.hitch(this,function(x, y) {
			this.setBlock(x, y, this.current.type);
		  }));
		},
		removeLines : function () {
		  var x, y, complete, n = 0;
		  for(y = this.ny ; y > 0 ; --y) {
			complete = true;
			for(x = 0 ; x < this.nx ; ++x) {
			  if (!this.getBlock(x, y))
				complete = false;
			}
			if (complete) {
			  this.removeLine(y);
			  y = y + 1; // recheck same line
			  n++;
			}
		  }
		  if (n > 0) {
			this.addRows(n);
			// the more lines removed, the higher the score
			this.addScore(100*Math.pow(2,n-1)); // 1: 100, 2: 200, 3: 400, 4: 800
		  }
		},
		removeLine : function (n) {
		  var x, y;
		  for(y = n ; y >= 0 ; --y) {
			for(x = 0 ; x < this.nx ; ++x)
			  this.setBlock(x, y, (y == 0) ? null : this.getBlock(x, y-1));
		  }
		},
		//-------------------------------------------------------------------------
		// RENDERING
		//-------------------------------------------------------------------------
		invalidate : function()       { this._invalid.court  = true; },
		invalidateNext : function()     { this._invalid.next   = true; },
		invalidateScore : function()    { this._invalid.score  = true; },
		invalidateRows : function()     { this._invalid.rows   = true; },
		invalidateLevel : function()     { this._invalid.level   = true; },		
		draw : function()  {
		  if (this.consoleLogging){
			  console.log('draw');
		  }
		  this.ctx.save();
		  this.ctx.lineWidth = 1;
		  this.ctx.translate(0.5, 0.5); // for crisp 1px black lines
		  this.drawCourt();
		  this.drawNext();
		  this.drawScore();
		  this.drawRows();
		  this.drawLevel();
		  this.ctx.restore();
		},
		drawCourt : function()  {
		  if (this._invalid.court) {
			this.ctx.clearRect(0, 0, this.canvasDiv.width, this.canvasDiv.height);
			if (this.playing)
			  this.drawPiece(this.ctx, this.current.type, this.current.x, this.current.y, this.current.dir);
			var x, y, block;
			for(y = 0 ; y < this.ny ; y++) {
			  for (x = 0 ; x < this.nx ; x++) {
				if (block = this.getBlock(x,y)){
				  this.drawBlock(this.ctx, x, y, block.color);
				} 
			  }
			}
			this.ctx.strokeRect(0, 0, this.nx*this.dx - 1, this.ny*this.dy - 1); // court boundary
			this._invalid.court = false;
		  }
		},
		drawScore : function()  {
		  if (this._invalid.score) {
			this.html('score', ("00000" + Math.floor(this.vscore)).slice(-5));
			this._invalid.score = false;
		  }
		},
		drawRows : function() {
		  if (this._invalid.rows) {
			this.html('rows', this.rows);
		
			var speed = (this.initialStep) / (this.step);
			// show speed rounded up to 2 digits
			this.html('speed', speed.toFixed(2));
			this._invalid.rows = false;
		  }
		},
		drawLevel : function() {
		  if (this._invalid.level) {
			this.html('level', this.level);
			this._invalid.level = false;
		  }
		},
		drawNext : function()  {
			if (this.consoleLogging){
				console.log('drawNext');
			}
			if (this._invalid.next) {

				var padding = (this.nu - this.next.type.size) / 2; // centering next piece display
				this.uctx.save();
				this.uctx.translate(0.5, 0.5);
				this.uctx.clearRect(0, 0, this.nu*this.dx, this.nu*this.dy);
				this.drawPiece(this.uctx, this.next.type, padding, padding, this.next.dir);
				this.uctx.strokeStyle = 'black';
				this.uctx.strokeRect(0, 0, (this.nu*this.dx - 1), this.nu*this.dy - 1);
				this.uctx.restore();
				this._invalid.next = false;
			}
		},
		drawPiece : function(ctx, type, x, y, dir) {
			if (this.consoleLogging){
				console.log('drawPiece');
			}
			this.eachblock(type, x, y, dir, dojo.hitch(this,function(x, y) {
				this.drawBlock(ctx, x, y, type.color);
			}));
		},
		drawBlock : function(ctx, x, y, color) {
			if (this.consoleLogging){
				console.log('drawBlock');
				console.log(color);
				console.log(x);
				console.log(this.dx);
				console.log(y);
				console.log(this.dy);
			}
			ctx.fillStyle = 'rgb(' + color + ',' + (this.blockOpacity / 10)+ ')';

			ctx.fillRect(x*this.dx, y*this.dy, this.dx, this.dy);
			ctx.strokeRect(x*this.dx, y*this.dy, this.dx, this.dy);

		},
		validateName : function(){
			var name = this.nameInput.value;
			if (name.length > 0){
				return true;
			} else {
				mx.ui.error(this.emptyNameMessage, true);
			}	
		},
		addGameLog : function(message,logLevel){
			var timeNow = new Date().toLocaleTimeString("en-US");
			var log = timeNow + ' || ' + message;	
			if (logLevel == 'warn'){
				console.warn(log);
			} else {
				console.log(log);
			}	
			this.gameLog = this.gameLog + log;
		},
		_execMf: function (mf, guid, cb) {

			if (mf && guid) {
				
				mx.data.action({
					params: {
						applyto: "selection",
						actionname: mf,
						guids: [guid]
					},
					store: {
						caller: this.mxform
					},
					callback: dojo.hitch(this, function (result) {
						if (!result){
							mx.ui.error('Please play a fair game, score not stored :)!', true);
						}						
					}),
					error: dojo.hitch(this,function (error) {
						
						console.debug(error.description);
					})
				}, this);
			}
		}		
		
	});
});

require(["Tetris/widget/Tetris"], function() {
    "use strict";
});


