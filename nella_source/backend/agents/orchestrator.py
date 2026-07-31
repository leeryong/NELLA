"""
Main Orchestrator Agent.
Coordinates all agents for end-to-end pipeline execution.
"""
import asyncio
import json
from pathlib import Path
from typing import Optional, AsyncGenerator

from loguru import logger

from backend.config import settings
from backend.agents.document_agent import document_agent
from backend.agents.data_gen_agent import data_gen_agent
from backend.agents.training_agent import training_agent
from backend.agents.eval_agent import eval_agent
from backend.agents.autoresearch_agent import autoresearch_agent, AutoResearchConfig
from backend.agents.model_selection_agent import model_selection_agent
from backend.agents.model_validation_agent import model_validation_agent


class Orchestrator:
    """
    Main orchestrator that coordinates all agents.
    Provides high-level pipeline operations.
    """

    async def run_full_pipeline(
        self,
        document_path: str,
        model_id: str,
        dataset_name: str = "pipeline_dataset",
        training_method: str = "lora",
        num_qa_pairs: int = 50,
        epochs: int = 3,
        max_steps: int = -1,
        use_autoresearch: bool = False,
        progress_callback=None,
    ) -> dict:
        """
        Run the complete pipeline:
        1. Process document
        2. Generate training data
        3. Download model (if needed)
        4. Train model
        5. Evaluate

        Returns dict with all results.
        """
        results = {}
        logger.info(f"Starting full pipeline for {document_path}")

        async def emit(phase: str, data: dict):
            data["phase"] = phase
            if progress_callback:
                await progress_callback(data)
            logger.info(f"Pipeline [{phase}]: {data}")

        # Step 1: Process document
        await emit("document_processing", {"status": "started", "file": document_path})
        try:
            from backend.services.document_processor import document_processor
            doc_result = await document_processor.process_document(
                Path(document_path), save_extracted=True
            )
            results["document"] = doc_result
            await emit("document_processing", {"status": "completed", **doc_result})
        except Exception as e:
            logger.error(f"Document processing failed: {e}")
            raise

        # Step 2: Generate training data
        await emit("data_generation", {"status": "started", "num_pairs": num_qa_pairs})
        try:
            dataset_result = await data_gen_agent.generate_sft_data(
                document_id=0,
                extracted_text_path=doc_result["extracted_path"],
                num_pairs=num_qa_pairs,
                dataset_name=dataset_name,
            )
            results["dataset"] = dataset_result
            await emit("data_generation", {"status": "completed", **dataset_result})
        except Exception as e:
            logger.error(f"Data generation failed: {e}")
            raise

        # Step 3: Get model
        await emit("model_download", {"status": "checking", "model_id": model_id})
        local_path = model_selection_agent.get_ready_path(model_id)
        if not local_path:
            await emit("model_download", {"status": "downloading", "model_id": model_id})
            local_path = await model_selection_agent.ensure_model_downloaded(model_id)
        results["model_path"] = str(local_path)
        await emit("model_download", {"status": "ready", "path": str(local_path)})

        # Step 4: Train
        await emit("training", {"status": "started", "method": training_method})
        job_id = hash(f"{document_path}_{model_id}") % 100000

        try:
            if use_autoresearch:
                ar_config = AutoResearchConfig(
                    base_model_id=model_id,
                    base_model_path=str(local_path),
                    train_data_path=dataset_result["train_path"],
                    eval_data_path=dataset_result.get("test_path"),
                    method=training_method,
                    max_trials=settings.AUTORESEARCH_MAX_TRIALS,
                    steps_per_trial=settings.AUTORESEARCH_STEPS_PER_TRIAL,
                    output_base_dir=str(settings.MODELS_DIR),
                )
                train_result = await autoresearch_agent.run(job_id, ar_config)
                output_dir = train_result.get("final_model_path")
            else:
                train_result = await training_agent.start_sft_training(
                    job_id=job_id,
                    dataset_id=0,
                    base_model_path=str(local_path),
                    base_model_id=model_id,
                    train_data_path=dataset_result["train_path"],
                    test_data_path=dataset_result.get("test_path"),
                    method=training_method,
                    config_overrides={
                        "num_train_epochs": epochs,
                        "max_steps": max_steps,
                    },
                )
                output_dir = train_result.get("output_dir")

            results["training"] = train_result
            await emit("training", {"status": "completed", "output_dir": output_dir})

        except Exception as e:
            logger.error(f"Training failed: {e}")
            raise

        # Step 5: Evaluate
        await emit("evaluation", {"status": "started"})
        try:
            eval_results = await eval_agent.run_evaluation(
                training_job_id=job_id,
                model_path=output_dir,
                test_data_path=dataset_result.get("test_path"),
                sample_limit=50,
            )
            results["evaluation"] = eval_results
            await emit("evaluation", {"status": "completed", **eval_results})
        except Exception as e:
            logger.warning(f"Evaluation failed (non-fatal): {e}")
            results["evaluation"] = {"error": str(e)}

        logger.info("Full pipeline completed successfully")
        return results

    async def stream_pipeline_events(
        self,
        document_path: str,
        model_id: str,
        **kwargs,
    ) -> AsyncGenerator[dict, None]:
        """Stream pipeline progress events."""
        events = asyncio.Queue()

        async def callback(data):
            await events.put(data)

        async def run():
            try:
                result = await self.run_full_pipeline(
                    document_path, model_id,
                    progress_callback=callback,
                    **kwargs,
                )
                await events.put({"type": "done", "result": result})
            except Exception as e:
                await events.put({"type": "error", "error": str(e)})

        task = asyncio.create_task(run())

        while True:
            event = await events.get()
            yield event
            if event.get("type") in ("done", "error"):
                break

        await task


# Module-level singleton
orchestrator = Orchestrator()
