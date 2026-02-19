import GObject from "gi://GObject";
import Gio from "gi://Gio";
import Adw from "gi://Adw?version=1";

import { EggheadWindow } from "./window.js";
import { AboutDialog } from "./about.js";
import { EggheadPreferencesDialog } from "./preferences.js";
import "./lib/he.js";

export const EggheadApplication = GObject.registerClass(
  class EggheadApplication extends Adw.Application {
    constructor() {
      super({
        application_id: pkg.name,
        flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
      });

      const quitAction = new Gio.SimpleAction({ name: "quit" });
      quitAction.connect("activate", (action) => {
        this.quit();
      });
      this.add_action(quitAction);

      const preferencesAction = new Gio.SimpleAction({ name: "preferences" });
      preferencesAction.connect("activate", (action) => {
        const preferencesDialog = new EggheadPreferencesDialog();

        preferencesDialog.present(this.active_window);
      });
      this.add_action(preferencesAction);

      this.set_accels_for_action("app.quit", ["<primary>q"]);
      this.set_accels_for_action("win.toggle-sidebar", ["F9"]);
      this.set_accels_for_action("win.enable-search-mode", ["<primary>f"]);
      this.set_accels_for_action("win.start-quiz", ["<alt>s"]);
      this.set_accels_for_action("win.go-back", ["<primary>Left"]);
      this.set_accels_for_action("win.delete-saved-quiz", ["<primary>D"]);
      this.set_accels_for_action("app.preferences", ["<primary>comma"]);

      const showAboutAction = new Gio.SimpleAction({ name: "about" });
      showAboutAction.connect("activate", (action) => {
        const aboutDialog = AboutDialog();
        aboutDialog.present(this.active_window);
      });
      this.add_action(showAboutAction);
    }

    vfunc_activate() {
      let activeWindow = this.active_window;
      if (!activeWindow) activeWindow = new EggheadWindow(this);
      activeWindow.present();
    }
  }
);
