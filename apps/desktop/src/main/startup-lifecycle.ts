type ActivatableWindow={isDestroyed():boolean;isMinimized():boolean;restore():void;show():void;focus():void};

/** Windows forwards repeat shortcut launches even before the first window exists. */
export function createWindowActivation(){
  let window:ActivatableWindow|undefined;
  let pending=false;
  const activate=()=>{
    if(!window||window.isDestroyed()){pending=true;return;}
    pending=false;
    if(window.isMinimized())window.restore();
    window.show();window.focus();
  };
  return {activate,attach(value:ActivatableWindow){window=value;if(pending)activate();}};
}
