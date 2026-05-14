export type CandidateOrderRow = {
  id: string;
  sourceOrder: number;
};

export function rankCandidateOrderRows(
  candidates: CandidateOrderRow[],
  downloadCounts: ReadonlyMap<string, number>,
) {
  if (downloadCounts.size === 0) {
    return candidates;
  }

  return candidates.toSorted((a, b) => {
    const downloadRank = (downloadCounts.get(b.id) ?? 0) - (downloadCounts.get(a.id) ?? 0);
    return downloadRank || a.sourceOrder - b.sourceOrder;
  });
}

export function rankedCandidatePageIds(
  candidates: CandidateOrderRow[],
  downloadCounts: ReadonlyMap<string, number>,
  start: number,
  pageSize: number,
) {
  return rankCandidateOrderRows(candidates, downloadCounts)
    .slice(start, start + pageSize)
    .map((candidate) => candidate.id);
}
