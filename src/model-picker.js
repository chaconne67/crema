// Lucide (ISC) "zap": marks the fast (priority processing) variant of a model.
export const ZAP_ICON =
  '<svg class="zap" viewBox="0 0 24 24" aria-label="빠른 속도"><path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/></svg>';

// Lucide (ISC) "chevron-right"; turned down while its Provider is open.
export const PROVIDER_CHEVRON = '<svg class="menu-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

/**
 * The model menu as one list: every signed-in Provider as a collapsible row, with only `openKey`'s
 * models shown under it — each fast-capable model followed by its ⚡ variant, for the /model command
 * menu. `selection` = { key, name, fast } of the saved choice.
 */
export const AUTO_LABEL = "자동 (무료 AI)";
// Told wherever the automatic choice is made: its judging sends the request's start to Crema's site.
export const AUTO_NOTE = "알맞은 모델을 고르려고 질문 앞부분(최대 2,000자)을 Crema 서버에 보내 판정하며, 저장하지 않습니다.";

// `auto`: offer "자동 (무료 AI)" first (some free Provider is connected); `selection.auto` marks it chosen.
export function modelMenuRows(catalog, selection, openKey, auto = false) {
  const first = auto ? [{ kind: "auto", label: AUTO_LABEL, selected: Boolean(selection.auto) }] : [];
  return first.concat(catalog.flatMap((group) => [
    { kind: "provider", key: group.key, label: group.provider, open: group.key === openKey },
    ...(group.key !== openKey
      ? []
      : group.models.flatMap((model) =>
          [false, ...(model.fast ? [true] : [])].map((fast) => ({
            kind: "model",
            model,
            fast,
            label: model.name,
            selected: group.key === selection.key && model.name === selection.name && fast === Boolean(selection.fast),
          })),
        )),
  ]));
}

/**
 * Settings model chooser: opens with the current model's Provider expanded and that model highlighted;
 * clicking another Provider opens it instead. getSelection() → { key, provider, name, fast }.
 */
