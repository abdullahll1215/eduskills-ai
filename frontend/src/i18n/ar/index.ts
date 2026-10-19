// Arabic dictionary, split by area so each part can be maintained on its own.
import admin from "./admin";
import common from "./common";
import staff from "./staff";
import student from "./student";

const ar: Record<string, string> = { ...common, ...student, ...staff, ...admin };
export default ar;
