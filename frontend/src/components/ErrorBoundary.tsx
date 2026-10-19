import { Component, ReactNode } from "react";
import { DEMO } from "../api/client";
import { translate } from "../i18n";

/** Shows what went wrong instead of a blank page, with a way to recover. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = async () => {
    if (DEMO) {
      const { resetDB } = await import("../demo/store");
      resetDB();
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card mx-auto max-w-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900">{translate("This page could not be displayed")}</h2>
        <p className="mt-2 text-sm text-slate-600">{translate("Something went wrong while showing this page. You can try again, or reset the demo data if the problem continues.")}</p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-red-700">{this.state.error.message}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>{translate("Try again")}</button>
          {DEMO && <button className="btn-outline" onClick={this.reset}>{translate("Reset demo data")}</button>}
        </div>
      </div>
    );
  }
}
