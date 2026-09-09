import { getObjCClassDeclar } from "marginnote"
import {
  handlers,
  lifecycle,
  onAnswerCardPan,
  onAnswerCardResize,
  onChooseAnswerCandidate,
  onAnswerToolbarClick,
  onMistakeToolbarClick,
  onMistakeLevel0Click,
  onMistakeLevel1Click,
  onMistakeLevel2Click,
  ensureMnutilsEntrance,
  onMnutilsEntranceClick,
  onMnutilsEntranceLongPress,
  onMnutilsEntrancePan,
  onMistakeLinkToolbarClick,
  onCloseAnswerCard,
  onRefreshAnswerCard,
  onPanelCloseButtonSideChanged,
  openMenu,
  queryAddonCommandStatus
} from "./plugin"

const Extension = JSB.defineClass(
  getObjCClassDeclar("答案匹配", "JSExtension"),
  {
    ...lifecycle.instanceMethods,
    ...handlers,
    queryAddonCommandStatus,
    onAnswerToolbarClick,
    onChooseAnswerCandidate,
    onMistakeToolbarClick,
    onMistakeLevel0Click,
    onMistakeLevel1Click,
    onMistakeLevel2Click,
    onMistakeLinkToolbarClick,
    onCloseAnswerCard,
    onRefreshAnswerCard,
    onPanelCloseButtonSideChanged,
    onAnswerCardPan,
    onAnswerCardResize,
    ensureMnutilsEntrance,
    onMnutilsEntranceClick,
    onMnutilsEntranceLongPress,
    onMnutilsEntrancePan,
    openMenu
  },
  lifecycle.classMethods
)

JSB.newAddon = () => Extension
