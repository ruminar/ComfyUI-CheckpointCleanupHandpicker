from .checkpoint_cleanup_handpicker import CheckpointCleanupReview, CheckpointListSelector

NODE_CLASS_MAPPINGS = {
    "CheckpointCleanupReview": CheckpointCleanupReview,
    "CheckpointListSelector": CheckpointListSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckpointCleanupReview": "Checkpoint Cleanup Review",
    "CheckpointListSelector": "Checkpoint List Selector",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
