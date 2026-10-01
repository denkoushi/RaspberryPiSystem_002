"""Weekly encrypted Pi4 SD-card backup to Google Drive, run from the Business Pi5.

The Pi5 streams each kiosk's root and boot filesystems over SSH straight into a
restic repository on Google Drive, so nothing is staged on the Pi5 SSD and the
Pi4 SD card is only read. A dead card is replaced by restoring the same
terminal's latest snapshot onto a new card in a USB reader on the Pi5.
"""
