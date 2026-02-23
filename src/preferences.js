import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";

const difficultyLevels = [
  {
    key: "mixed",
    description: _("Mixed"),
  },
  {
    key: "easy",
    description: _("Easy"),
  },
  {
    key: "medium",
    description: _("Medium"),
  },
  {
    key: "hard",
    description: _("Hard"),
  },
];

export const EggheadPreferencesDialog = GObject.registerClass(
  {
    GTypeName: "EggheadPreferencesDialog",
    Template: __getResourceUri__("preferences.ui"),
    InternalChildren: ["system", "dark", "light", "difficulty_level"],
    Properties: {
      theme: GObject.ParamSpec.string(
        "theme",
        "Theme",
        "Preferred theme",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      difficulty: GObject.ParamSpec.string(
        "difficulty",
        "Difficulty",
        "Preferred difficulty",
        GObject.ParamFlags.READWRITE,
        ""
      ),
    },
  },
  class EggheadPreferencesDialog extends Adw.PreferencesDialog {
    constructor(options = {}) {
      super(options);

      this.setDifficultyLevelModel();

      this.settings = Gio.Settings.new(pkg.name);
      this.settings.bind(
        "preferred-theme",
        this,
        "theme",
        Gio.SettingsBindFlags.DEFAULT
      );
      this.settings.bind(
        "difficulty",
        this,
        "difficulty",
        Gio.SettingsBindFlags.DEFAULT
      );

      this.bind_property_full(
        "theme",
        this._system,
        "active",
        GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE,
        (_, theme) => [true, theme === "system"],
        (_, theme) => [theme, "system"]
      );

      this.bind_property_full(
        "theme",
        this._light,
        "active",
        GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE,
        (_, theme) => [true, theme === "light"],
        (_, theme) => [theme, "light"]
      );

      this.bind_property_full(
        "theme",
        this._dark,
        "active",
        GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE,
        (_, theme) => [true, theme === "dark"],
        (_, theme) => [theme, "dark"]
      );

      this.bind_property_full(
        "difficulty",
        this._difficulty_level,
        "selected",
        GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE,
        (_, difficultyLevel) => {
          const difficultyObject = difficultyLevels.find(
            ({ key }) => key === difficultyLevel
          );

          if (!difficultyObject) {
            throw new Error(
              "Mismatch between difficulty keys in the settings and in difficultyLevels array"
            );
          }

          const model = this._difficulty_level.model;

          for (let i = 0; i < model.get_n_items(); i++) {
            const stringObject = model.get_item(i);

            if (stringObject?.string === difficultyObject.description) {
              return [true, i];
            }
          }
          return [false, 0];
        },
        (_, selected) => {
          const stringObject =
            this._difficulty_level.model.get_item(selected);

          if (stringObject?.string) {
            const difficultyObject = difficultyLevels.find(
              ({ description }) => description === stringObject?.string
            );

            if (!difficultyObject) {
              throw new Error(
                "There is a mismatch between difficulty descriptions in the difficulty level settings model and difficultyLevels array"
              );
            }

            return [true, difficultyObject.key];
          }

          return [false, "mixed"];
        }
      );
    }

    setDifficultyLevelModel = () => {
      const _difficultyLevels = difficultyLevels.map(
        ({ description }) => description
      );
      this._difficulty_level.model = Gtk.StringList.new(_difficultyLevels);

      const propExpression = Gtk.PropertyExpression.new(
        Gtk.StringObject,
        null,
        "string"
      );

      this._difficulty_level.expression = propExpression;
    };
  }
);
