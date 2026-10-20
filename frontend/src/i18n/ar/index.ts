// Arabic dictionary, split by area so each part can be maintained on its own.
import design from "./design";
import admin from "./admin";
import common from "./common";
import staff from "./staff";
import student from "./student";

const ar: Record<string, string> = { ...common, ...student, ...staff, ...admin, ...design };
export default ar;
