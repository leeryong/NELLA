"""
Evaluation Agent.
Manages model evaluation jobs and result storage.
"""
import asyncio
from pathlib import Path
from typing import Optional

from loguru import logger

from backend.services.evaluator import model_evaluator


class EvalAgent:
    """
    Agent that runs model evaluation and stores results.
    """

    async def run_evaluation(
        self,
        training_job_id: int,
        model_path: str,
        test_data_path: str,
        use_llm_judge: bool = False,
        sample_limit: Optional[int] = 100,
        base_model_path: Optional[str] = None,
        progress_cb=None,
    ) -> dict:
        """
        Run comprehensive model evaluation.

        Returns:
            dict with all evaluation metrics
        """
        logger.info(
            f"EvalAgent: evaluating job {training_job_id} "
            f"model={model_path}"
        )

        try:
            results = await model_evaluator.evaluate(
                model_path=model_path,
                test_data_path=test_data_path,
                use_llm_judge=use_llm_judge,
                sample_limit=sample_limit,
                base_model_path=base_model_path,
                progress_cb=progress_cb,
            )
            logger.info(f"Evaluation complete for job {training_job_id}: {results}")
            return results
        except Exception as e:
            logger.error(f"Evaluation failed for job {training_job_id}: {e}")
            raise

    async def compare_training_runs(
        self,
        model_paths: list[str],
        test_data_path: str,
        sample_limit: int = 50,
    ) -> list[dict]:
        """Compare multiple training runs."""
        return await model_evaluator.compare_models(
            model_paths, test_data_path, sample_limit
        )

    def format_results_report(self, results: dict) -> str:
        """Format evaluation results as a human-readable report."""
        lines = ["=" * 50, "EVALUATION RESULTS", "=" * 50]

        if results.get("bleu") is not None:
            lines.append(f"BLEU Score:       {results['bleu']:.4f}")
        if results.get("rouge1") is not None:
            lines.append(f"ROUGE-1:          {results['rouge1']:.4f}")
        if results.get("rouge2") is not None:
            lines.append(f"ROUGE-2:          {results['rouge2']:.4f}")
        if results.get("rougeL") is not None:
            lines.append(f"ROUGE-L:          {results['rougeL']:.4f}")
        if results.get("perplexity") is not None:
            lines.append(f"Perplexity:       {results['perplexity']:.2f}")
        if results.get("llm_judge_score") is not None:
            lines.append(f"LLM Judge Score:  {results['llm_judge_score']:.2f}/10")

        lines.append(f"Samples evaluated: {results.get('sample_count', 0)}")
        lines.append("=" * 50)

        # Show sample predictions
        samples = results.get("predictions_sample", [])
        if samples:
            lines.append("\nSAMPLE PREDICTIONS:")
            for i, sample in enumerate(samples[:2], 1):
                lines.append(f"\n[Sample {i}]")
                lines.append(f"Reference: {sample['reference'][:200]}...")
                lines.append(f"Predicted: {sample['prediction'][:200]}...")

        return "\n".join(lines)


# Module-level singleton
eval_agent = EvalAgent()
