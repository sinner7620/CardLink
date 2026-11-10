export interface OCRPreferences {
  incremental:boolean; autoRetry:boolean; scheduled:boolean; sourceConsent:boolean; intervalHours:number
  engine:'glm-ocr'|'mineru'; notebookId:string; consentAt:number; nextAt:number; configKey:string
}
export function ocrPreferences(value:any):OCRPreferences {
  return {incremental:value?.incremental!==false,autoRetry:value?.autoRetry===true,scheduled:value?.scheduled===true,sourceConsent:value?.sourceConsent===true,intervalHours:[1,6,24].includes(value?.intervalHours)?value.intervalHours:24,engine:value?.engine==='mineru'?'mineru':'glm-ocr',notebookId:String(value?.notebookId||''),consentAt:Number(value?.consentAt)||0,nextAt:Number(value?.nextAt)||0,configKey:String(value?.configKey||'')}
}
export function safeAutomaticRetry(kind:string,uncertain:boolean,attempts:number) {return !uncertain&&attempts<3&&['rate','network','timeout'].includes(kind)}
