-- Expand approval ranks without changing existing mappings or review snapshots.
ALTER TABLE "KnowledgePositionRank" DROP CONSTRAINT "KnowledgePositionRank_rank_check";
ALTER TABLE "KnowledgePositionRank" ADD CONSTRAINT "KnowledgePositionRank_rank_check"
  CHECK ("rank" IN ('general','leader','section_chief','manager','general_manager','executive'));

ALTER TABLE "KnowledgeProcedureReview" DROP CONSTRAINT "KnowledgeProcedureReview_rank_check";
ALTER TABLE "KnowledgeProcedureReview" ADD CONSTRAINT "KnowledgeProcedureReview_rank_check"
  CHECK ("employeeRankSnapshot" IN ('general','leader','section_chief','manager','general_manager','executive'));
