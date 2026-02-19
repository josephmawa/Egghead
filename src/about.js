import Adw from "gi://Adw?version=1";
import Gtk from "gi://Gtk";

const aboutParams = {
  application_name: __APPLICATION_NAME__,
  developer_name: "Joseph Mawa",
  application_icon: pkg.name,
  version: pkg.version,
  license_type: Gtk.License.LGPL_3_0,
  developers: ["Joseph Mawa"],
  artists: ["Joseph Mawa"],
  copyright: "© 2025 Joseph Mawa",
  ...__PROJECT_URLS__,
};

export const AboutDialog = () => {
  return new Adw.AboutDialog(aboutParams);
};
