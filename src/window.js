import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";

import { Category } from "./category.js";
import { triviaCategories } from "./util/data.js";
import {
  shuffle,
  fetchQuiz,
  formatData,
  getCustomFilter,
  generateMetadata,
  parseTriviaCategories,
} from "./util/utils.js";
import { Quiz, initialQuiz } from "./util/quiz.js";
import { Page } from "./util/page.js";

function getFilePath(args) {
  const DATA_DIR = GLib.get_user_data_dir();
  return GLib.build_filenamev([DATA_DIR, "trivia", ...args]);
}

export const EggheadWindow = GObject.registerClass(
  {
    GTypeName: "EggheadWindow",
    Template: __getResourceUri__("window.ui"),
    Properties: {
      category_name: GObject.ParamSpec.string(
        "category_name",
        "categoryName",
        "Selected Category Name",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      category_id: GObject.ParamSpec.int(
        "category_id",
        "categoryId",
        "Selected Category ID",
        GObject.ParamFlags.READWRITE,
        // This requires specifying min and max for binding to work
        0,
        5000,
        9
      ),
      is_downloading: GObject.ParamSpec.boolean(
        "is_downloading",
        "isDownloading",
        "Is downloading quiz",
        GObject.ParamFlags.READWRITE,
        false
      ),
      has_error: GObject.ParamSpec.boolean(
        "has_error",
        "hasError",
        "Has an error occurred?",
        GObject.ParamFlags.READWRITE,
        false
      ),
      game_on: GObject.ParamSpec.boolean(
        "game_on",
        "gameOn",
        "Has started quiz",
        GObject.ParamFlags.READWRITE,
        false
      ),
      selected: GObject.ParamSpec.int(
        "selected",
        "Selected",
        "Selected quiz index",
        GObject.ParamFlags.READWRITE,
        0
      ),
      current_question: GObject.ParamSpec.string(
        "current_question",
        "currentQuestion",
        "Current question",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      quiz: GObject.ParamSpec.object(
        "quiz",
        "Quiz",
        "Current Quiz",
        GObject.ParamFlags.READWRITE,
        new Quiz(initialQuiz)
      ),
      quizStore: GObject.ParamSpec.object(
        "quizStore",
        "quiz_store",
        "Quiz list store",
        GObject.ParamFlags.READWRITE,
        GObject.Object
      ),
    },
    InternalChildren: [
      // Toast
      "toast_overlay",
      // Main UI
      "main_stack",
      "split_view",
      "search_bar",
      "list_view",
      "pagination_list_view",
      "single_selection",
      "difficulty_level_stack",
      // Pagination
      "go_to_first_page_btn",
      "go_to_prev_page_btn",
      "go_to_last_page_btn",
      "go_to_next_page_btn",
      // Difficulty
      "mixed",
      "easy",
      "medium",
      "hard",
      // Error
      "error_message_label",
    ],
  },
  class EggheadWindow extends Adw.ApplicationWindow {
    constructor(application) {
      super({ application });
      this.quizStore = new Gio.ListStore(Quiz);

      this.createActions();
      this.createPaginationActions();
      this.createSidebar();
      this.createToast();

      this.loadStyles();
      this.bindSettings();
      this.setPreferredColorScheme();
      this.setDefaultDifficultyLevel();
      this.setListViewModel();
      this.bindPaginationBtns();
      this.bindQuiz();
      this.initCategoryNameProperty();
      this.getMetadata();
    }

    setSelectedCategory = (category) => {
      this.category_name = category.name;
      this.category_id = category.id;

      if (category.hasChildren) {
        this._difficulty_level_stack.visible_child_name = "category_view";
      } else {
        this._difficulty_level_stack.visible_child_name = "sub_category_view";
      }
    };

    createActions = () => {
      const toggleSidebar = new Gio.SimpleAction({ name: "toggle-sidebar" });
      toggleSidebar.connect("activate", (action) => {
        this._split_view.show_sidebar = !this._split_view.show_sidebar;
      });

      const enableSearchMode = new Gio.SimpleAction({
        name: "enable-search-mode",
      });
      enableSearchMode.connect("activate", (action) => {
        this._search_bar.search_mode_enabled =
          !this._search_bar.search_mode_enabled;
      });

      const startQuiz = new Gio.SimpleAction({
        name: "start-quiz",
      });
      startQuiz.connect("activate", async () => {
        try {
          this._main_stack.visible_child_name = "download_view";
          this.is_downloading = true;
          this.selected = 0;

          const difficultyLevel = this.settings.get_string("difficulty");
          const metaData = this.metaData[this.category_id][difficultyLevel];

          let formattedData;
          const filePath = getFilePath([
            this.category_id.toString(),
            difficultyLevel,
            "data.json",
          ]);

          if (metaData.saved) {
            const data = this.getSavedData(filePath);
            formattedData = shuffle(data);
          } else {
            const data = await fetchQuiz(this.category_id, difficultyLevel);
            if (data.length === 0) {
              throw new Error("Failed to fetch data");
            }

            metaData.saved = true;
            metaData.updatedOn = Date.now();
            this.metaData[this.category_id][difficultyLevel] = metaData;

            formattedData = formatData(data);
            this.saveData(formattedData, filePath);

            const metaDataFilePath = getFilePath(["metadata.json"]);
            this.saveData(this.metaData, metaDataFilePath);
          }

          this.populateListStore(formattedData);
          this.setListViewModel();
          this.initQuiz();
          this.bindPaginationBtns();

          this._main_stack.visible_child_name = "quiz_view";
          this._difficulty_level_stack.visible_child_name = "quiz_session_view";
          this.is_downloading = false;
          this.game_on = true;
        } catch (error) {
          console.error(error);
          this.setError(error.message);
          this.is_downloading = false;
          this.game_on = false;
        }
      });

      const goBack = new Gio.SimpleAction({
        name: "go-back",
      });
      goBack.connect("activate", () => {
        if (this.is_downloading) {
          const alertDialog = new Adw.AlertDialog({
            heading: _("Cancel Download"),
            body: _("Are you sure you want to cancel this download?"),
            default_response: "cancel_download",
            close_response: "close_dialog",
            presentation_mode: "floating",
          });

          alertDialog.add_response("cancel_download", _("Cancel"));
          alertDialog.add_response("close_dialog", _("Close"));

          alertDialog.set_response_appearance(
            "cancel_download",
            Adw.ResponseAppearance.DESTRUCTIVE
          );
          alertDialog.set_response_appearance(
            "close_dialog",
            Adw.ResponseAppearance.SUGGESTED
          );

          alertDialog.connect("response", (_alertDialog, response) => {
            if (response === "close_dialog") return;
            this._main_stack.visible_child_name = "quiz_view";
            this.is_downloading = false;
          });

          alertDialog.present(this);
        }

        if (this.has_error) {
          this.removeError();
        }
      });

      const selectDifficulty = new Gio.SimpleAction({
        name: "select-difficulty",
        parameter_type: GLib.VariantType.new("s"),
      });
      selectDifficulty.connect("activate", (_selectDifficulty, param) => {
        this.settings.set_value("difficulty", param);
      });

      const deleteSavedQuiz = new Gio.SimpleAction({
        name: "delete-saved-quiz",
      });
      deleteSavedQuiz.connect("activate", () => {
        const alertDialog = new Adw.AlertDialog({
          heading: _("Delete Saved Quiz"),
          body: _(
            "Are you sure you want to delete all the saved quiz? This action is irreversible."
          ),
          default_response: "delete_saved_quiz",
          close_response: "close_dialog",
          presentation_mode: "floating",
        });

        alertDialog.add_response("delete_saved_quiz", _("Delete"));
        alertDialog.add_response("close_dialog", _("Close"));

        alertDialog.set_response_appearance(
          "delete_saved_quiz",
          Adw.ResponseAppearance.DESTRUCTIVE
        );
        alertDialog.set_response_appearance(
          "close_dialog",
          Adw.ResponseAppearance.SUGGESTED
        );

        alertDialog.connect("response", (_alertDialog, response) => {
          if (response === "close_dialog") return;

          const metaData = Object.keys(this.metaData);

          for (const key of metaData) {
            const difficulties = Object.keys(this.metaData[key]);
            for (const difficulty of difficulties) {
              const metaDataObj = this.metaData[key][difficulty];
              if (metaDataObj.saved) {
                const filePath = getFilePath([
                  key.toString(),
                  difficulty,
                  "data.json",
                ]);

                this.deleteSavedData(filePath);
                metaDataObj.saved = false;
                metaDataObj.updatedOn = 0;
                this.metaData[key][difficulty] = metaDataObj;
              }
            }
          }

          const metaDataFilePath = getFilePath(["metadata.json"]);
          this.saveData(this.metaData, metaDataFilePath);
          this.displayToast(_("Deleted saved quiz"));
        });

        alertDialog.present(this);
      });

      const pickAnswer = new Gio.SimpleAction({
        name: "pick-answer",
        parameter_type: GLib.VariantType.new("s"),
      });
      pickAnswer.connect("activate", (_pickAnswer, param) => {
        const answerId = param.unpack();
        this.quiz.answers[answerId].active = true;

        const otherIds = [
          "answer_1",
          "answer_2",
          "answer_3",
          "answer_4",
        ].filter((id) => id !== answerId);

        for (const id of otherIds) {
          this.quiz.answers[id].active = false;
        }
        this.quiz.submit_button_sensitive = true;
      });

      const submitSolution = new Gio.SimpleAction({
        name: "submit-solution",
      });
      submitSolution.connect("activate", () => {
        try {
          const answerIds = ["answer_1", "answer_2", "answer_3", "answer_4"];
          let selectedAnswerId, correctAnswerId;
          for (const answerId of answerIds) {
            this.quiz.answers[answerId].sensitive = false;

            if (this.quiz.answers[answerId].active) {
              selectedAnswerId = answerId;
            }

            if (
              this.quiz.answers[answerId].answer === this.quiz.correct_answer
            ) {
              correctAnswerId = answerId;
            }
          }

          if (!selectedAnswerId || !correctAnswerId) {
            throw new Error(
              `Both ${selectedAnswerId} and ${correctAnswerId} should not be undefined`
            );
          }

          if (selectedAnswerId === correctAnswerId) {
            this.quiz.answers[selectedAnswerId].css_classes = ["success"];
          } else {
            this.quiz.answers[selectedAnswerId].css_classes = ["error"];
            this.quiz.answers[correctAnswerId].css_classes = ["success"];
          }

          this.quiz.submit_button_sensitive = false;
        } catch (error) {
          this.setError(error.message);
        }
      });

      this.add_action(toggleSidebar);
      this.add_action(enableSearchMode);
      this.add_action(startQuiz);
      this.add_action(goBack);
      this.add_action(selectDifficulty);
      this.add_action(deleteSavedQuiz);
      this.add_action(pickAnswer);
      this.add_action(submitSolution);
    };

    createPaginationActions = () => {
      const goToFirstPage = new Gio.SimpleAction({
        name: "go-to-first-page",
      });
      goToFirstPage.connect("activate", () => {
        this.selected = 0;
        this.scrollTo(this.selected);
      });

      const goToLastPage = new Gio.SimpleAction({
        name: "go-to-last-page",
      });
      goToLastPage.connect("activate", () => {
        const numItems = this._pagination_list_view.model.get_n_items();
        this.selected = numItems - 1;
        this.scrollTo(this.selected);
      });

      const goToPreviousPage = new Gio.SimpleAction({
        name: "go-to-previous-page",
      });
      goToPreviousPage.connect("activate", () => {
        if (this.selected === 0) return;

        this.scrollTo(--this.selected);
      });

      const goToNextPage = new Gio.SimpleAction({
        name: "go-to-next-page",
      });
      goToNextPage.connect("activate", () => {
        const numItems = this._pagination_list_view.model.get_n_items();
        if (this.selected === numItems - 1) {
          return;
        }

        this.scrollTo(++this.selected);
      });

      this.add_action(goToFirstPage);
      this.add_action(goToLastPage);
      this.add_action(goToPreviousPage);
      this.add_action(goToNextPage);
    };

    activateCategory(listView, position) {
      if (this.game_on) {
        const alertDialog = new Adw.AlertDialog({
          heading: _("Quiz in session"),
          body: _("Are you sure you want to cancel this quiz?"),
          default_response: "cancel_quiz",
          close_response: "close_dialog",
          presentation_mode: "floating",
        });

        alertDialog.add_response("cancel_quiz", _("Cancel"));
        alertDialog.add_response("close_dialog", _("Close"));

        alertDialog.set_response_appearance(
          "cancel_quiz",
          Adw.ResponseAppearance.DESTRUCTIVE
        );
        alertDialog.set_response_appearance(
          "close_dialog",
          Adw.ResponseAppearance.SUGGESTED
        );

        alertDialog.connect("response", (_alertDialog, response) => {
          if (response === "close_dialog") return;
          const model = listView.model;
          const selectedItem = model?.selected_item?.item;

          if (selectedItem) {
            this.setSelectedCategory(selectedItem);
            this.game_on = false;
          }
        });

        alertDialog.present(this);
      } else {
        const model = listView.model;
        const selectedItem = model?.selected_item?.item;

        if (selectedItem) {
          this.setSelectedCategory(selectedItem);
          this.game_on = false;
        }
      }
    }

    handleSearch(searchEntry) {
      const tree = this._list_view.model.model;
      const searchText = searchEntry.text.trim().toLocaleLowerCase();

      if (!searchText) {
        tree.autoexpand = false;
      } else {
        tree.autoexpand = true;
      }

      this.customFilter.set_filter_func(getCustomFilter(searchText));
    }

    createSidebar = () => {
      this.triviaCategories = parseTriviaCategories(triviaCategories);

      const store = Gio.ListStore.new(Category);
      for (const category of this.triviaCategories) {
        store.append(new Category(category));
      }

      const customFilter = Gtk.CustomFilter.new(null);
      const filter = Gtk.FilterListModel.new(store, customFilter);

      this.customFilter = customFilter;

      const tree = Gtk.TreeListModel.new(filter, false, false, (item) => {
        if (!item.hasChildren) return null;

        const nestedStore = Gio.ListStore.new(Category);
        const nestedModel = Gtk.FilterListModel.new(nestedStore, customFilter);
        for (const category of item.children) {
          nestedModel.model.append(new Category(category));
        }

        return nestedModel;
      });

      const selection = Gtk.SingleSelection.new(tree);
      const factory = new Gtk.SignalListItemFactory();

      factory.connect("setup", (_, listItem) => {
        const hBox = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          halign: Gtk.Align.FILL,
        });

        const hBoxInner1 = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          halign: Gtk.Align.START,
          hexpand: true,
        });
        const hBoxInner2 = new Gtk.Box({
          orientation: Gtk.Orientation.HORIZONTAL,
          halign: Gtk.Align.END,
          hexpand: true,
        });

        const label = new Gtk.Label();
        const icon = new Gtk.Image({
          icon_name: "egghead-object-select-symbolic",
          visible: false,
          pixel_size: 12,
        });

        hBoxInner1.append(label);
        hBoxInner2.append(icon);

        hBox.append(hBoxInner1);
        hBox.append(hBoxInner2);

        listItem.child = new Gtk.TreeExpander({ child: hBox });
      });

      factory.connect("bind", (_, listItem) => {
        const listRow = listItem.item;
        const expander = listItem.child;

        expander.list_row = listRow;

        const hBox = expander.child;
        const label = hBox?.get_first_child()?.get_first_child();
        const image = hBox?.get_last_child()?.get_first_child();
        const object = listRow.item;

        this.bind_property_full(
          "category_id",
          image,
          "visible",
          GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
          (_, categoryId) => {
            return [true, object.id === categoryId];
          },
          null
        );

        label.label = object.name;
      });

      this._list_view.model = selection;
      this._list_view.factory = factory;

      this.setSelectedCategory(this.triviaCategories[0]);
    };

    bindSettings = () => {
      this.settings = Gio.Settings.new(pkg.name);
      this.settings.bind(
        "window-width",
        this,
        "default-width",
        Gio.SettingsBindFlags.DEFAULT
      );
      this.settings.bind(
        "window-height",
        this,
        "default-height",
        Gio.SettingsBindFlags.DEFAULT
      );
      this.settings.bind(
        "window-maximized",
        this,
        "maximized",
        Gio.SettingsBindFlags.DEFAULT
      );

      this.settings.bind(
        "category-id",
        this,
        "category_id",
        Gio.SettingsBindFlags.DEFAULT
      );

      this.settings.connect(
        "changed::preferred-theme",
        this.setPreferredColorScheme
      );

      this.settings.connect(
        "changed::difficulty",
        this.setDefaultDifficultyLevel
      );
    };

    bindPaginationBtns = () => {
      this.bind_property_full(
        "selected",
        this._go_to_first_page_btn,
        "sensitive",
        GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
        (_, selected) => {
          if (selected > 0) return [true, true];
          return [true, false];
        },
        null
      );

      this.bind_property_full(
        "selected",
        this._go_to_prev_page_btn,
        "sensitive",
        GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
        (_, selected) => {
          if (selected > 0) return [true, true];
          return [true, false];
        },
        null
      );

      this.bind_property_full(
        "selected",
        this._go_to_last_page_btn,
        "sensitive",
        GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
        (_, selected) => {
          const numItems = this._pagination_list_view.model.get_n_items();
          if (selected < numItems - 1) return [true, true];
          return [true, false];
        },
        null
      );

      this.bind_property_full(
        "selected",
        this._go_to_next_page_btn,
        "sensitive",
        GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
        (_, selected) => {
          const numItems = this._pagination_list_view.model.get_n_items();
          if (selected < numItems - 1) return [true, true];
          return [true, false];
        },
        null
      );
    };

    bindQuiz = () => {
      this.bind_property_full(
        "selected",
        this,
        "quiz",
        GObject.BindingFlags.DEFAULT || GObject.BindingFlags.SYNC_CREATE,
        (_, selected) => {
          const quizObject = this.quizStore.get_item(selected);
          return [true, quizObject];
        },
        null
      );
    };

    loadStyles = () => {
      const cssProvider = new Gtk.CssProvider();
      cssProvider.load_from_resource(__getResourcePath__("index.css"));

      Gtk.StyleContext.add_provider_for_display(
        this.display,
        cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_USER
      );
    };

    setPreferredColorScheme = () => {
      const preferredColorScheme = this.settings.get_string("preferred-theme");
      const { DEFAULT, FORCE_LIGHT, FORCE_DARK } = Adw.ColorScheme;
      let colorScheme = DEFAULT;

      if (preferredColorScheme === "system") {
        colorScheme = DEFAULT;
      }

      if (preferredColorScheme === "light") {
        colorScheme = FORCE_LIGHT;
      }

      if (preferredColorScheme === "dark") {
        colorScheme = FORCE_DARK;
      }

      this.application.get_style_manager().color_scheme = colorScheme;
    };

    setDefaultDifficultyLevel = () => {
      const difficulty = this.settings.get_string("difficulty");

      switch (difficulty) {
        case "mixed":
          this._mixed.active = true;
          break;

        case "easy":
          this._easy.active = true;
          break;

        case "medium":
          this._medium.active = true;
          break;

        case "hard":
          this._hard.active = true;
          break;

        default:
          throw new Error(`${difficulty} is an invalid difficulty level`);
      }
    };

    setListViewModel = () => {
      const store = Gio.ListStore.new(Page);
      const numItems = this.quizStore.get_n_items();

      for (let i = 0; i < numItems; i++) {
        store.append(new Page((i + 1).toString()));
      }

      this._single_selection.model = store;
      this.selected = 0;

      this._pagination_list_view.connect("activate", (listView, position) => {
        this.selected = position;
        this.scrollTo(position);
      });
    };

    initQuiz = () => {
      this.quiz = this.quizStore.get_item(this.selected);
    };

    initCategoryNameProperty = () => {
      const categoryId = this.settings.get_value("category-id")?.unpack();

      for (const category of this.triviaCategories) {
        if (category.id === categoryId) {
          this.category_name = category.name;
          break;
        }

        if (category.hasChildren) {
          const childCategory = category.children.find(
            ({ id }) => id === categoryId
          );

          if (childCategory) {
            this.category_name = childCategory.name;
            break;
          }
        }
      }
    };

    scrollTo = (position) => {
      this._pagination_list_view.scroll_to(
        position,
        Gtk.ListScrollFlags.FOCUS,
        null
      );
    };

    populateListStore = (data) => {
      this.quizStore.remove_all();
      for (const object of data) {
        this.quizStore.append(new Quiz(object));
      }
    };

    setError = (errorMessage) => {
      this.has_error = true;
      this._error_message_label.label = errorMessage;
      this._main_stack.visible_child_name = "error_view";
    };

    removeError = () => {
      this.has_error = false;
      this._error_message_label.label = "";
      this._main_stack.visible_child_name = "quiz_view";
    };

    getMetadata = () => {
      const filePath = getFilePath(["metadata.json"]);
      let metaData = this.getSavedData(filePath);

      if (Object.keys(metaData).length) {
        this.metaData = metaData;
        return;
      }

      metaData = generateMetadata(triviaCategories);
      const flag = this.saveData(metaData, filePath);

      if (flag) {
        this.metaData = metaData;
      } else {
        console.log(_("Failed to save metadata"));
      }
    };

    createToast = () => {
      this.toast = new Adw.Toast({ timeout: 1 });
    };

    displayToast = (message) => {
      this.toast.dismiss();
      this.toast.title = message;
      this._toast_overlay.add_toast(this.toast);
    };

    getSavedData = (filePath) => {
      const file = Gio.File.new_for_path(filePath);
      const path = file.get_path();
      const fileExists = GLib.file_test(path, GLib.FileTest.EXISTS);

      if (!fileExists) {
        const data = [];
        this.saveData(data, filePath);
        return data;
      }

      const [success, arrBuff] = GLib.file_get_contents(path);

      if (success) {
        const decoder = new TextDecoder("utf-8");
        const savedData = JSON.parse(decoder.decode(arrBuff));
        return savedData;
      } else {
        console.log(_("Failed to read saved data"));
        return [];
      }
    };

    saveData = (data = [], filePath) => {
      const file = Gio.File.new_for_path(filePath);
      const path = file.get_parent().get_path();

      // 0o777 is file permission, ugo+rwx, in numeric mode
      const flag = GLib.mkdir_with_parents(path, 0o777);

      if (flag === 0) {
        const [success, tag] = file.replace_contents(
          JSON.stringify(data),
          null,
          false,
          Gio.FileCreateFlags.REPLACE_DESTINATION,
          null
        );

        if (success) {
          console.log(_("Successfully saved quiz to file"));
          return true;
        } else {
          console.log(_("Failed to save quiz to file"));
          return false;
        }
      }

      if (flag === -1) {
        console.log(_("An error occurred while creating directory"));
        return false;
      }
    };

    deleteSavedData = (path) => {
      const file = Gio.File.new_for_path(path);
      const filePath = file.get_path();

      const fileExists = GLib.file_test(filePath, GLib.FileTest.EXISTS);
      if (!fileExists) {
        console.log(_("%s doesn't exist".format(filePath)));
        throw new Error("%s doesn't exist".format(filePath));
      }

      const innerDirPath = file.get_parent()?.get_path();
      const outerDirPath = file.get_parent()?.get_parent().get_path();

      const fileDeleteFlag = file.delete(null);
      if (fileDeleteFlag) {
        console.log(_("Deleted %s successfully").format(filePath));
      } else {
        throw new Error("Failed to delete %s".format(filePath));
      }

      const innerDirDeleteFlag = GLib.rmdir(innerDirPath);
      if (innerDirDeleteFlag === 0) {
        console.log(_("Deleted %s successfully").format(innerDirPath));
      } else {
        throw new Error("Failed to delete %s".format(innerDirPath));
      }

      const outerDeleteflag = GLib.rmdir(outerDirPath);
      if (outerDeleteflag === 0)
        console.log(_("Deleted %s successfully").format(outerDirPath));
      else {
        console.log("Failed to delete %s".format(outerDirPath));
      }
    };
  }
);
