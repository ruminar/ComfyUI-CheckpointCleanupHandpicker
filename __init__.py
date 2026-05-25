from .checkpoint_cleanup_handpicker import (
    CheckpointCleanupReview,
    CheckpointListSelector,
#    CheckpointStatusFilter,
    CheckpointStatusTagger,
)

NODE_CLASS_MAPPINGS = {
    "CheckpointCleanupReview": CheckpointCleanupReview,
    "CheckpointListSelector": CheckpointListSelector,
#    "CheckpointStatusFilter": CheckpointStatusFilter,
    "CheckpointStatusTagger": CheckpointStatusTagger,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckpointCleanupReview": "Checkpoint Cleanup Review",
    "CheckpointListSelector": "Checkpoint List Selector",
#    "CheckpointStatusFilter": "Checkpoint Status Filter",
    "CheckpointStatusTagger": "Checkpoint Status Tagger",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
