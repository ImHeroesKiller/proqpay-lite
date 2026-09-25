'use client';

import React from 'react';

type Props = {
  moduleName:string;
  resetKey:string | number;
  children:React.ReactNode;
  onRetry?:()=>void;
};

type State = { error:Error | null };

export default class ModuleErrorBoundary extends React.Component<Props,State> {
  state:State={ error:null };

  static getDerivedStateFromError(error:Error):State {
    return { error };
  }

  componentDidUpdate(prevProps:Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error:null });
    }
  }

  componentDidCatch(error:Error, info:React.ErrorInfo) {
    console.error(JSON.stringify({
      level:'error',
      source:'module-error-boundary',
      module:this.props.moduleName,
      message:error.message,
      componentStack:info.componentStack,
    }));
  }

  private retry = () => {
    this.setState({ error:null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="card module-error-boundary" role="alert" aria-live="assertive">
      <span className="workspace-eyebrow">MODULE RECOVERY</span>
      <h2>{this.props.moduleName} tidak dapat ditampilkan</h2>
      <p>Modul mengalami error saat render. Data modul lain dan sesi aplikasi tetap dipertahankan.</p>
      <small>{this.state.error.message}</small>
      <div>
        <button type="button" className="btn btn-primary" onClick={this.retry}>Retry module</button>
      </div>
    </section>;
  }
}
