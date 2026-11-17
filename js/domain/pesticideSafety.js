// Domain Safety Check: Product & Active Ingredient Use Limits + PHI
function evaluatePesticideSafety_(selectedFields, pestIds, workDateStr) {
  const workDateMs = new Date(String(workDateStr || '2026-08-05').replace(/\//g, '-')).setHours(0, 0, 0, 0);
  const overUseMessages = [];
  const phiMessages = [];

  // 今回同時に散布する農薬群の中で同一有効成分が何剤含まれるかもカウント（例：スタークル液剤＋スタークル粒剤の同時選択）
  const batchIngredientAdd = {};
  pestIds.forEach(pid => {
    const p = pesticides[pid];
    if (!p) return;
    const ing = p.activeIngredient || pid;
    batchIngredientAdd[ing] = (batchIngredientAdd[ing] || 0) + 1;
  });

  pestIds.forEach(pid => {
    const pest = pesticides[pid];
    if (!pest) return;
    const ing = pest.activeIngredient || pid;
    const addIngCount = batchIngredientAdd[ing] || 1;

    // 1. 商品別および有効成分別の使用回数上限チェック
    const violatedFields = [];
    selectedFields.forEach(f => {
      const curProdCount = (f.pestCount && f.pestCount[pid]) || 0;
      const curIngCount = (f.ingredientCount && f.ingredientCount[ing]) || curProdCount;
      if (curProdCount + 1 > pest.maxUse || curIngCount + addIngCount > pest.maxUse) {
        violatedFields.push({
          name: f.name,
          curProdCount,
          curIngCount,
          byIngredient: (curIngCount + addIngCount > pest.maxUse) && (curIngCount > curProdCount || addIngCount > 1)
        });
      }
    });

    if (violatedFields.length > 0) {
      const names = violatedFields.map(v =>
        v.byIngredient
          ? `${escapeHtml(v.name)}（有効成分「${escapeHtml(ing)}」計${v.curIngCount}回使用済）`
          : `${escapeHtml(v.name)}（${v.curProdCount}回使用済）`
      ).join('・');
      overUseMessages.push(
        `⚠️ <strong>農薬・有効成分 使用回数超過アラート</strong>：${escapeHtml(pest.name)}（有効成分: <strong>${escapeHtml(ing)}</strong> / 上限${pest.maxUse}回）が上限を超過します［対象: ${names}］！`
      );
    }

    // 2. 収穫前日数（PHI）チェック
    const phiViolations = [];
    selectedFields.forEach(f => {
      if (!f.harvest) return;
      const harvMs = new Date(String(f.harvest).replace(/\//g, '-')).setHours(0, 0, 0, 0);
      if (!isNaN(workDateMs) && !isNaN(harvMs)) {
        const diffDays = Math.floor((harvMs - workDateMs) / (1000 * 60 * 60 * 24));
        if (diffDays < pest.phiDays) {
          phiViolations.push({ field: f, diffDays });
        }
      }
    });

    if (phiViolations.length > 0) {
      const phiDetails = phiViolations.map(v =>
        v.diffDays < 0
          ? `${escapeHtml(v.field.name)}（収穫予定日 ${escapeHtml(v.field.harvest)} を ${Math.abs(v.diffDays)} 日経過）`
          : `${escapeHtml(v.field.name)}（収穫予定 ${escapeHtml(v.field.harvest)} まで残り ${v.diffDays} 日）`
      ).join('・');
      phiMessages.push(
        `⚠️ <strong>収穫前日数（PHI）制限違反アラート</strong>：${escapeHtml(pest.name)} は収穫前 <strong>${pest.phiDays}日以内</strong> の散布が禁止されています［対象: ${phiDetails}］！`
      );
    }
  });

  return {
    ok: overUseMessages.length === 0 && phiMessages.length === 0,
    overUseMessages,
    phiMessages,
    allMessages: [...overUseMessages, ...phiMessages]
  };
}

