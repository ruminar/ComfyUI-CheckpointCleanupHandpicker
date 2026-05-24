from .checkpoint_cleanup_handpicker import CheckpointCleanupReview

NODE_CLASS_MAPPINGS = {
    "CheckpointCleanupReview": CheckpointCleanupReview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckpointCleanupReview": "Checkpoint Cleanup Review",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
