const Gettext = imports.gettext;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;

const Extension = imports.ui.extensionSystem.extensions['putWindow@clemens.lab21.org'];
const SettingsWindow = Extension.settingsWindow.SettingsWindow;

let _path;

/**
 * Handles all keybinding stuff and moving windows.
 * Binds following keyboard shortcuts:
 *  - run_command_1 to "Open SimpleMenu"
 *  - move_to_side_n/e/s/w move and resize windows
 *  - move_to_corner_ne/se/sw/nw move an resize to the corners
 *
 * Thanks to:
 * gcampax for auto-move-window extension and
 * vibou_ for gtile and his getInner/OuterPadding that is used in nearly every
 *        extension that moves windows around
 *
 * Believe in the force! Read the source!
 **/
function MoveWindow() {
  this._init();
};

MoveWindow.prototype = {

  _settings: {},

  //list of config parameters
  CENTER_WIDTH: "centerWidth",
  CENTER_HEIGHT: "centerHeight",
  SIDE_WIDTH: "sideWidth",
  SIDE_HEIGHT: "sideHeight",
  PANEL_BUTTON_VISIBLE: "panelButtonPosition",

  // private variables
  _keyBindingHandlers: [],
  _bindings: [],
  _shellwm: global.window_manager,
  // settingsButton
  _settingsButton: null,

  _topBarHeight: 28,

  _primary: 0,
  _screens: [],

  /**
   * Helper functions to takeover binding when enabled and release them
   * on disbale. Will change when 3.4 is available and extensions can register
   * bindings.
   */
  _addKeyBinding: function(keybinding, handler) {
    if (this._keyBindingHandlers[keybinding])
      this._shellwm.disconnect(this._keyBindingHandlers[keybinding]);
    else {
      this._shellwm.takeover_keybinding(keybinding);
      this._bindings[this._bindings.length] = keybinding;
    }

    this._keyBindingHandlers[keybinding] =
        this._shellwm.connect('keybinding::' + keybinding, handler);
  },

  _recalcuteSizes: function(s) {
    let tbHeight = (s.primary && !Main.panel.hidden) ? this._topBarHeight : 4;
    s.y = s.geomY + tbHeight;
    s.height = s.totalHeight * this._getSideHeight() - tbHeight;
    s.sy = (s.totalHeight - s.height) + s.geomY;
    s.width = s.totalWidth * this._getSideWidth();

    return s;
  },

  /**
   * pass width or height = -1 to maximize in this direction
   */
  _moveFocused: function(where) {
    let win = global.display.focus_window;
    if (win==null) {
        return;
    }
    var pos = win.get_outer_rect();

    let sIndex = this._primary;
    let sl = this._screens.length;

    // left edge is sometimes -1px...
    pos.x = pos.x < 0 ? 0 : pos.x;
    for (let i=0; i<sl; i++) {
      if (i == sl-1) {
        sIndex = i;
        break;
      }
      if (this._screens[i].x <= pos.x && this._screens[(i+1)].x > pos.x) {
        sIndex = i;
        break;
      }
    }

    let s = this._screens[sIndex];

    // check if we are on primary screen and if the main panel is visible
    s = this._recalcuteSizes(s);

    let moveRightX = s.x;
    if (where.indexOf("e") > -1) {
       moveRightX = s.geomX + s.totalWidth - s.width;
    }

    let diff = null,
      sameWidth = this._samePoint(pos.width, s.width);

    // sIndex is the target index if we move to another screen.-> primary!=sIndex
    let winHeight = pos.height + this._topBarHeight;
    let maxH = (pos.height >= s.totalHeight) || this._samePoint(winHeight, s.totalHeight);

    if (where=="n") {
      this._resize(win, s.x, s.y, -1, s.height);
    } else if (where == "e") {
      // fixme. wont move left...
      if (sIndex < (sl-1) && sameWidth && maxH && pos.x + s.width >= s.totalWidth) {
        s = this._recalcuteSizes(this._screens[(sIndex+1)]);
        this._resize(win, s.x, s.y, s.width, -1);
      } else {
        this._resize(win, moveRightX, s.y, s.width, -1); //(s.x + s.width)
      }
      win.last_move = "e";
    } else if (where == "s") {
      this._resize(win, s.x, s.sy, -1, s.height);
    } else if (where == "w") {
      // if we are not on screen[i>0] move window to the left screen
      let newX = pos.x - s.width;
      if (sIndex > 0 && sameWidth && maxH && newX < (s.width + 150)) {
        s = this._screens[(sIndex-1)];
        moveRightX = s.geomX + s.totalWidth - s.width;
        this._resize(win, moveRightX, s.y, s.width, -1); // (s.x + s.width)
      } else {
        this._resize(win, s.x, s.y, s.width, -1);
      }
    }

    if (where == "ne") {
      this._resize(win, moveRightX, s.y, s.width, s.height)
    } else if (where == "se") {
      this._resize(win, moveRightX, s.sy, s.width, s.height)
    } else if (where == "sw") {
      this._resize(win, s.x, s.sy, s.width, s.height)
    } else if (where == "nw") {
      this._resize(win, s.x, s.y, s.width, s.height)
    }

    // calculate the center position and check if the window is already there
    if (where == "c") {

      let w = s.totalWidth * (this._settings.getNumber(this.CENTER_WIDTH, 50) / 100),
        h = s.totalHeight * (this._settings.getNumber(this.CENTER_HEIGHT, 50) / 100),
        x = s.x + (s.totalWidth - w) / 2,
        y = s.y + (s.totalHeight - h) / 2,
        sameHeight = this._samePoint(h, pos.height);

      // do not check window.width. until i find get_size_hint(), or min_width..
      // windows that have a min_width < our width it will not work (evolution for example)
      if (this._samePoint(x, pos.x) && this._samePoint(y, pos.y) && sameHeight) {
        // the window is alread centered -> maximize
        this._resize(win, s.x, s.y, -1, -1);
      } else {
        // the window is not centered -> resize
        this._resize(win, x, y, w, h);
      }
    }
  },

  _moveConfiguredWhenCreated: function(display, win, noResurce) {
    if (!this._windowTracker.is_window_interesting(win)) {
      return;
    }

    let app = win.get_wm_class();

    if (!app) {
      if (!noRecurse) {
        // window is not tracked yet
        Mainloop.idle_add(Lang.bind(this, function() {
          this._moveConfiguredWhenCreated(display, win, true);
          return false;
        }));
      }
      return;
    }

    // move the window if a location is configured and autoMove is set to true
    let appPath = "locations." + app;
    if (this._settings.getParameter(appPath)) {
      if (this._settings.getBoolean(appPath + ".autoMove", false)) {
        this._moveToConfiguredLocation(win, app);
      }
    }
  },

  /**
   * check if the current focus window has a configured location. If so move it there ;)
   */
  _moveToConfiguredLocation: function(win, appName) {

    if (!win || !appName) {
      win = global.display.focus_window;
      if (win==null) {
          return;
      }

      appName = win.get_wm_class();
    }

    let config = this._settings.getParameter("locations." + appName, false);
    if (!config) {
      return;
    }


    let pos = config.positions[config.lastPosition];
    if (!pos) {
      pos = config.positions[0];
      config.lastPosition = 0;
      this._settings.setParameter("locations." + appName + ".lastPosition", 1);
    } else {
      config.lastPosition++;
    }


    if (config.lastPosition >= config.positions.length) {
      this._settings.setParameter("locations." + appName + ".lastPosition", 0);
    }

    // config may be for 2 screens but currenty only 1 is connected
    let s = (this._screens.length > pos.screen) ? this._screens[pos.screen] : this._screens[0];

    let x = (pos.x=="0.0") ? s.x : s.x + (s.totalWidth * pos.x/100);
    let y = (pos.y=="0.0") ? s.y : s.totalHeight - (s.totalHeight * (1-pos.y/100));

    // _resize will maximize the window if width/height is -1
    let width = (pos.width == 100) ? -1 : s.totalWidth * pos.width/100;
    let height = (pos.height == 100) ? -1 : s.totalHeight * pos.height/100;

    this._resize(win, x, y, width, height);
  },

  // moving the window and the actual position are not really the same
  // if the points are < 30 points away asume as equal
  _samePoint: function(p1, p2) {
    return (Math.abs(p1-p2) <= 20);
  },

  // actual resizing
  _resize: function(win, x, y, width, height) {

    if (height == -1) {
      win.maximize(Meta.MaximizeFlags.VERTICAL);
      height = 400; // dont resize to width, -1
    } else {
      win.unmaximize(Meta.MaximizeFlags.VERTICAL);
    }

    if (width == -1) {
      win.maximize(Meta.MaximizeFlags.HORIZONTAL);
      width = 400;  // dont resize to height, -1
    } else {
      win.unmaximize(Meta.MaximizeFlags.HORIZONTAL);
    }

    // first move the window
    let padding = this._getPadding(win);
    // snap, x, y
    win.move_frame(true, x - padding.x, y - padding.y);
    // snap, width, height, force
    win.resize(true, width - padding.width, height - padding.height);
  },

  // the difference between input and outer rect as object.
  _getPadding: function(win) {
    let outer = win.get_outer_rect(),
      inner = win.get_input_rect();
    return {
      x: outer.x - inner.x,
      y: (outer.y - inner.y),
      width: 2, //(inner.width - outer.width),
      height: (inner.height - outer.height)
    };
  },

  _checkSize: function(p) {
    if (!p || p < 0 || p > 100) {
      return 50;
    }

    return p;
  },

  _getSideWidth: function() {
    return this._settings.getNumber(this.SIDE_WIDTH, 50) / 100;
  },

  _getSideHeight: function() {
    return this._settings.getNumber(this.SIDE_HEIGHT, 50) / 100;
  },

  /**
   * Get global.screen_width and global.screen_height and
   * bind the keys
   **/
  _init: function() {
    // read configuration and init the windowTracker
    this._settings = new SettingsWindow(_path + "putWindow.json");
    let buttonPosition = this._settings.getNumber(this.PANEL_BUTTON_VISIBLE, 0);
    if (buttonPosition == 1) {
      this._settingsButton = new SettingButton(this._settings);
      Main.panel._rightBox.insert_actor(this._settingsButton.actor, 0);
    } else {
      this._settingsButton = new PopupMenu.PopupMenuItem(_("PutWindow Settings"));
      this._settingsButton.connect('activate',
        Lang.bind(this, function() {
          this._settings.toggle();
        })
      );
      Main.panel._statusArea.userMenu.menu.addMenuItem(this._settingsButton, 5);
    }

    this._windowTracker = Shell.WindowTracker.get_default();

    let display = global.screen.get_display();
    this._windowCreatedListener = display.connect_after('window-created', Lang.bind(this, this._moveConfiguredWhenCreated));

    // get monotor(s) geometry
    this._primary = global.screen.get_primary_monitor();
    let numMonitors = global.screen.get_n_monitors();

    // only tested with 2 screen setup
    for (let i=0; i<numMonitors; i++) {
      let geom = global.screen.get_monitor_geometry(i),
        totalHeight = geom.height;

      this._screens[i] =  {
        y: (i==this._primary) ? geom.y + this._topBarHeight : geom.y,
        x : geom.x,
        geomX: geom.x,
        geomY: geom.y,
        totalWidth: geom.width,
        totalHeight: totalHeight,
        width: geom.width * this._getSideWidth()
      };

      this._screens[i].primary = (i==this._primary)

      // the position.y for s, sw and se
      this._screens[i].sy = (totalHeight - this._screens[i].y + this._topBarHeight) * this._getSideHeight();
    }

    // sort by x position. makes it easier to find the correct screen
    this._screens.sort(function(s1, s2) {
        return s1.x - s2.x;
    });

    // move to n, e, s an w
    this._addKeyBinding("move_to_side_n",
      Lang.bind(this, function(){ this._moveFocused("n");})
    );
    this._addKeyBinding("move_to_side_e",
      Lang.bind(this, function(){ this._moveFocused("e");})
    );
    this._addKeyBinding("move_to_side_s",
      Lang.bind(this, function(){ this._moveFocused("s");})
    );
    this._addKeyBinding("move_to_side_w",
      Lang.bind(this, function(){ this._moveFocused("w");})
    );

    // move to  nw, se, sw, nw
    this._addKeyBinding("move_to_corner_ne",
      Lang.bind(this, function(){ this._moveFocused("ne");})
    );
    this._addKeyBinding("move_to_corner_se",
      Lang.bind(this, function(){ this._moveFocused("se");})
    );
    this._addKeyBinding("move_to_corner_sw",
      Lang.bind(this, function(){ this._moveFocused("sw");})
    );
    this._addKeyBinding("move_to_corner_nw",
      Lang.bind(this, function(){ this._moveFocused("nw");})
    );

    // move to center. fix 2 screen setup and resize to 50% 50%
    this._addKeyBinding("move_to_center",
      Lang.bind(this, function(){ this._moveFocused("c");})
    );

    this._addKeyBinding("move_to_workspace_1",
      Lang.bind(this, function(){ this._moveToConfiguredLocation();})
    );
  },

  /**
   * disconnect all keyboard bindings that were added with _addKeyBinding
   **/
  destroy: function() {

    if (this._windowCreatedListener) {
      global.screen.get_display().disconnect(this._windowCreatedListener);
      this._windowCreatedListener = 0;
    }

    let size = this._bindings.length;
    for(let i = 0; i<size; i++) {
        this._shellwm.disconnect(this._keyBindingHandlers[this._bindings[i]]);
    }

    if (this._settingsButton) {
      this._settingsButton.destroy();
    }
    this._settings.destroy();
  }
}

function SettingButton(settings) {
  this._init(settings);
}

SettingButton.prototype = {
  __proto__: PanelMenu.ButtonBox.prototype,

  _settingsWindow: {},

  _init : function(settings) {
    PanelMenu.ButtonBox.prototype._init.call(this, {
       reactive: true,
       can_focus: true,
       track_hover: true,
       style_class: 'put-window-settings-icon'
    });

    this._settingsWindow = settings;
    this.setTooltip(_("PutWindow Settings"));
    this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
  },

  _onButtonPress: function(actor, event){
    this._settingsWindow.toggle();
  },

  setTooltip: function(text) {
    if (text != null) {
      this.tooltip = text;
      this.actor.has_tooltip = true;
      this.actor.tooltip_text = text;
    } else {
      this.actor.has_tooltip = false;
      this.tooltip = null;
    }
  }

}

function init(meta) {
  _path = meta.path+"/";
  let userExtensionLocalePath = meta.path + '/locale';
  Gettext.bindtextdomain("putWindow", userExtensionLocalePath);
  Gettext.textdomain("putWindow");
};

function enable() {
  this._moveWindow = new MoveWindow();
};

function disable(){
  this._moveWindow.destroy();
};
